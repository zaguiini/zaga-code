# Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the project into a self-contained Electron desktop app: the agent runs as a tRPC HTTP server, the React SPA is served statically, everything starts automatically, and `zaga /path` opens a new session from the CLI.

**Architecture:** Electron main process starts a tRPC server on `:2024` (LangGraph agent + SQLite checkpointer) and a static file server on `:3000` (Vite SPA). The web UI uses `@trpc/react-query` — no LangGraph SDK. Raw LangGraph `streamEvents` are passed through to the frontend, which handles all event processing. The `AppRouter` type from `apps/agent` is the shared contract.

**Tech Stack:** Electron 33, tRPC v11, `@trpc/react-query`, `@langchain/langgraph-checkpoint-sqlite`, `better-sqlite3`, `sirv`, TanStack Router (SPA), Vite 7, TypeScript

**Reference:** The `refactor` branch (`git show refactor:apps/...`) has a working SQLite checkpointer and streaming state reducer in `apps/cli`. Port from there rather than rebuilding.

**Context7:** Before implementing any task, use the context7 MCP to look up current documentation for the relevant library. Key libraries: `@trpc/server`, `@trpc/react-query`, `electron`, `@langchain/langgraph`, `better-sqlite3`, `sirv`.

---

## File Map

**New files:**

- `apps/agent/src/db.ts` — SQLite connection + threads metadata table
- `apps/agent/src/checkpointer.ts` — `SqliteSaver` instance
- `apps/agent/src/settings.ts` — Zod schema for `~/.zaga/settings.json` (replaces `env.ts`)
- `apps/agent/src/server/trpc.ts` — tRPC init + context type
- `apps/agent/src/server/router.ts` — `appRouter` + exported `AppRouter` type
- `apps/agent/src/server/index.ts` — starts HTTP server, exports `startAgentServer`
- `apps/web/src/main.tsx` — SPA entry point (replaces TanStack Start entry)
- `apps/web/index.html` — Vite SPA root HTML
- `apps/web/src/lib/trpc.ts` — typed tRPC client + React provider setup
- `apps/web/src/hooks/streamReducer.ts` — pure reducer for raw LangGraph stream events
- `apps/web/src/hooks/useAgentStream.ts` — hook wrapping tRPC subscription + reducer
- `apps/desktop/package.json`
- `apps/desktop/tsconfig.json`
- `apps/desktop/electron-builder.config.cjs`
- `apps/desktop/src/main.ts` — Electron main process
- `apps/desktop/src/servers.ts` — starts `:2024` and `:3000` servers
- `apps/desktop/bin/zaga` — CLI launcher script

**Modified files:**

- `apps/agent/src/graphs/agent.ts` — use `settings.ts`, accept checkpointer in `createAgent()`
- `apps/agent/src/setup.ts` — use `settings.ts`, skip lms when `apiKey` present
- `apps/agent/package.json` — add tRPC + SQLite deps, add server export
- `apps/web/vite.config.ts` — remove TanStack Start/Nitro, pure Vite SPA
- `apps/web/src/env.ts` — rename `VITE_LANGGRAPH_API_URL` to `VITE_AGENT_API_URL`
- `apps/web/src/routes/__root.tsx` — add tRPC provider
- `apps/web/src/routes/_layout.$threadId.tsx` — replace `useStream` with `useAgentStream`
- `apps/web/src/routes/_layout.index.tsx` — read `projectPath` from URL, use tRPC
- `apps/web/package.json` — remove TanStack Start/langgraph-sdk, add tRPC
- `package.json` (root) — add `desktop:dev` and `desktop:build` scripts

**Deleted files:**

- `apps/agent/src/env.ts` — replaced by `settings.ts`
- `apps/web/src/lib/ai-client.ts` — replaced by tRPC client

---

## Task 1: Add SQLite persistence to apps/agent

**Files:**

- Create: `apps/agent/src/db.ts`
- Create: `apps/agent/src/checkpointer.ts`
- Modify: `apps/agent/package.json`

- [ ] **Step 1: Look up current docs**

Use context7 MCP: resolve `@langchain/langgraph-checkpoint-sqlite` and `better-sqlite3`, fetch their current docs.

- [ ] **Step 2: Install dependencies**

```bash
cd apps/agent
pnpm add @langchain/langgraph-checkpoint-sqlite better-sqlite3
pnpm add -D @types/better-sqlite3
```

- [ ] **Step 3: Create `apps/agent/src/db.ts`**

```ts
import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const dbDir = join(homedir(), '.zaga')
mkdirSync(dbDir, { recursive: true })

export const dbPath = join(dbDir, 'history.db')

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    thread_id    TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_message TEXT
  )
`)
```

- [ ] **Step 4: Create `apps/agent/src/checkpointer.ts`**

```ts
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { dbPath } from './db.js'

export const checkpointer = SqliteSaver.fromConnString(dbPath)
```

- [ ] **Step 5: Smoke-test**

```bash
cd apps/agent
node --import tsx/esm -e "import('./src/db.js').then(() => console.log('ok'))"
ls ~/.zaga/history.db
```

Expected: `~/.zaga/history.db` exists.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/db.ts apps/agent/src/checkpointer.ts apps/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): add SQLite DB and checkpointer"
```

---

## Task 2: Replace env vars with settings.json

**Files:**

- Create: `apps/agent/src/settings.ts`
- Delete: `apps/agent/src/env.ts`
- Modify: `apps/agent/src/graphs/agent.ts`
- Modify: `apps/agent/src/setup.ts`

The `.env` file and `process.env` parsing are replaced by `~/.zaga/settings.json` parsed with Zod. Zod defaults handle the lmStudio fallback values so callers always get a fully resolved config.

- [ ] **Step 1: Create `apps/agent/src/settings.ts`**

```ts
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const settingsSchema = z.object({
  // If apiKey is present, uses this provider directly (any OpenAI-compatible API).
  // Otherwise, lmStudio is assumed: model is the lms model key, apiBase is the local server.
  apiKey: z.string().optional(),
  model: z.string().default('lmstudio-community/gemma-3-12b-it'),
  apiBase: z.string().default('http://localhost:1234/v1'),
})

export type Settings = z.infer<typeof settingsSchema>

function load(): Settings {
  try {
    const raw = readFileSync(join(homedir(), '.zaga', 'settings.json'), 'utf-8')
    return settingsSchema.parse(JSON.parse(raw))
  } catch {
    return settingsSchema.parse({})
  }
}

export const settings = load()

export function isExternalProvider(s: Settings): s is Settings & { apiKey: string } {
  return typeof s.apiKey === 'string'
}
```

- [ ] **Step 2: Update `apps/agent/src/graphs/agent.ts`**

Replace all references to `env.MODEL` and `env.MODEL_API_BASE_URL` with `settings`. Replace `createModel()` and `queryMaxTokens()`, and update `createAgent()` to accept an optional checkpointer:

```ts
import { settings, isExternalProvider } from '../settings.js'
import type { BaseCheckpointSaver } from '@langchain/langgraph'

export function createModel() {
  return new ChatOpenAIWithReasoning({
    model: settings.model,
    configuration: { baseURL: settings.apiBase },
    apiKey: settings.apiKey ?? 'local',
    temperature: 0.3,
    streaming: true,
    streamUsage: true,
  })
}

async function queryMaxTokens(): Promise<number> {
  if (isExternalProvider(settings)) return 128_000
  const info = await queryModelInfo(settings.model)
  return info.maxTokens
}

export async function createAgent(opts: { checkpointer?: BaseCheckpointSaver } = {}) {
  const maxTokens = await queryMaxTokens()
  const graph = buildAgentGraph({ maxTokens })
  return graph.compile({ checkpointer: opts.checkpointer })
}
```

Remove the `import { env } from '@/env'` line from `agent.ts`.

- [ ] **Step 3: Update `apps/agent/src/setup.ts`**

Replace the `env` import with `settings` and `isExternalProvider`. Add a guard at the top of `setup()` to skip lmStudio when an external provider is configured, and replace all `env.MODEL` references with `settings.model`:

```ts
import { settings, isExternalProvider } from './settings.js'

export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  logLevel = options.logLevel ?? 'silent'

  if (isExternalProvider(settings)) {
    return { model: { id: settings.model, maxTokens: 128_000 } }
  }

  // existing lmStudio flow — replace env.MODEL with settings.model throughout
  try {
    await setupLmStudioModel()
    log('Setup complete!')
    const model = await queryModelInfo(settings.model)
    return { model }
  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
}
```

Also replace `env.MODEL` in `setupLmStudioModel()` and `queryModelInfo()` calls inside `setup.ts` with `settings.model`. Remove the `env` import.

- [ ] **Step 4: Delete `apps/agent/src/env.ts` and fix remaining imports**

```bash
grep -r "from.*['\"].*env['\"]" apps/agent/src/
```

Fix any remaining references, then delete the file:

```bash
git rm apps/agent/src/env.ts
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/agent
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/settings.ts apps/agent/src/graphs/agent.ts apps/agent/src/setup.ts
git commit -m "feat(agent): replace env vars with ~/.zaga/settings.json (Zod-parsed)"
```

---

## Task 3: Set up tRPC in apps/agent

**Files:**

- Create: `apps/agent/src/server/trpc.ts`
- Create: `apps/agent/src/server/router.ts` (scaffold)
- Modify: `apps/agent/package.json`

- [ ] **Step 1: Look up current docs**

Use context7 MCP: resolve `@trpc/server` and fetch docs on `initTRPC`, subscriptions with async generators, and the standalone adapter.

- [ ] **Step 2: Install tRPC**

```bash
cd apps/agent
pnpm add @trpc/server@next
```

- [ ] **Step 3: Create `apps/agent/src/server/trpc.ts`**

```ts
import { initTRPC } from '@trpc/server'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { AgentState } from '../graphs/agent.js'

export type Context = {
  graph: CompiledStateGraph<AgentState, Partial<AgentState>, '__start__'>
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const procedure = t.procedure
```

- [ ] **Step 4: Scaffold `apps/agent/src/server/router.ts`**

```ts
import { router } from './trpc.js'

export const appRouter = router({})
export type AppRouter = typeof appRouter
```

- [ ] **Step 5: Add server exports to `apps/agent/package.json`**

Add to the `"exports"` field:

```json
"./server": "./src/server/index.ts",
"./server/router": "./src/server/router.ts"
```

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/server/ apps/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): scaffold tRPC server"
```

---

## Task 4: Implement threads procedures

**Files:**

- Modify: `apps/agent/src/server/router.ts`

- [ ] **Step 1: Implement threads router**

Replace the scaffold in `apps/agent/src/server/router.ts`:

```ts
import { z } from 'zod'
import { router, procedure } from './trpc.js'
import { db } from '../db.js'

type ThreadRow = {
  thread_id: string
  project_path: string
  created_at: string
  last_message: string | null
}

const threadsRouter = router({
  create: procedure.input(z.object({ projectPath: z.string() })).mutation(({ input }) => {
    const threadId = crypto.randomUUID()
    db.prepare('INSERT INTO threads (thread_id, project_path) VALUES (?, ?)').run(
      threadId,
      input.projectPath
    )
    return { threadId }
  }),

  list: procedure.query(() => {
    const rows = db.prepare('SELECT * FROM threads ORDER BY created_at DESC').all() as ThreadRow[]
    return {
      threads: rows.map(r => ({
        threadId: r.thread_id,
        projectPath: r.project_path,
        createdAt: r.created_at,
        lastMessage: r.last_message,
      })),
    }
  }),

  get: procedure.input(z.object({ threadId: z.string() })).query(async ({ input, ctx }) => {
    const state = await ctx.graph.getState({
      configurable: { thread_id: input.threadId },
    })
    return {
      messages: (state.values.messages ?? []) as unknown[],
      usedTokens: (state.values.usedTokens as number | undefined) ?? 0,
      maxTokens: (state.values.maxTokens as number | undefined) ?? 0,
    }
  }),
})

export const appRouter = router({ threads: threadsRouter })
export type AppRouter = typeof appRouter
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/agent && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/server/router.ts
git commit -m "feat(agent): implement threads tRPC procedures"
```

---

## Task 5: Implement runs procedures (raw stream pass-through)

**Files:**

- Modify: `apps/agent/src/server/router.ts`

The subscription yields raw LangGraph `streamEvents` v2 objects directly — no mapping, no custom event type. The frontend handles all interpretation. An `AbortController` per thread enables cancellation.

- [ ] **Step 1: Add the runs router**

Add after the existing imports at the top of `apps/agent/src/server/router.ts`:

```ts
const abortControllers = new Map<string, AbortController>()
```

Add the runs router:

```ts
const runsRouter = router({
  stream: procedure
    .input(z.object({ threadId: z.string(), input: z.string() }))
    .subscription(async function* ({ input, ctx }) {
      const ac = new AbortController()
      abortControllers.set(input.threadId, ac)

      try {
        const eventStream = ctx.graph.streamEvents(
          {
            messages: [{ type: 'human', content: [{ type: 'text', text: input.input }] }],
          },
          {
            version: 'v2',
            configurable: { thread_id: input.threadId },
            signal: ac.signal,
          }
        )

        for await (const event of eventStream) {
          yield event
        }

        db.prepare('UPDATE threads SET last_message = ? WHERE thread_id = ?').run(
          input.input.slice(0, 100),
          input.threadId
        )
      } catch (err) {
        if ((err as Error).name !== 'AbortError') throw err
      } finally {
        abortControllers.delete(input.threadId)
      }
    }),

  cancel: procedure.input(z.object({ threadId: z.string() })).mutation(({ input }) => {
    abortControllers.get(input.threadId)?.abort()
    return { ok: true }
  }),
})
```

Update the exported `appRouter`:

```ts
export const appRouter = router({
  threads: threadsRouter,
  runs: runsRouter,
})
export type AppRouter = typeof appRouter
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/agent && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/server/router.ts
git commit -m "feat(agent): implement runs.stream (raw pass-through) and runs.cancel"
```

---

## Task 6: Create agent HTTP server entry point

**Files:**

- Create: `apps/agent/src/server/index.ts`

- [ ] **Step 1: Create `apps/agent/src/server/index.ts`**

```ts
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { appRouter } from './router.js'
import { checkpointer } from '../checkpointer.js'
import { createAgent } from '../graphs/agent.js'

export async function startAgentServer(port: number) {
  const graph = await createAgent({ checkpointer })

  const server = createHTTPServer({
    router: appRouter,
    createContext: () => ({ graph }),
    middleware(req, res, next) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, trpc-batch-mode')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      next()
    },
  })

  server.listen(port)
  console.log(`Agent tRPC server listening on :${port}`)
  return server
}
```

- [ ] **Step 2: Smoke-test**

```bash
cd apps/agent
node --import tsx/esm -e "
import { startAgentServer } from './src/server/index.js'
startAgentServer(2024).then(() => console.log('ok')).catch(console.error)
"
```

Expected: `Agent tRPC server listening on :2024`. Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/server/index.ts
git commit -m "feat(agent): add HTTP server entry point"
```

---

## Task 7: Migrate apps/web to Vite SPA

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`

- [ ] **Step 1: Look up current docs**

Use context7 MCP: resolve `@tanstack/react-router` and fetch docs on SPA/Vite setup with file-based routing (no SSR).

- [ ] **Step 2: Update `apps/web/package.json`**

Remove: `@tanstack/react-start`, `nitro`, `@tanstack/react-router-ssr-query`, `@langchain/langgraph-sdk`, `@tanstack/ai`, `@tanstack/ai-react`, `@tanstack/devtools-vite`.

Add: `@trpc/client@next`, `@trpc/react-query@next`, `@zaga/agent` (workspace).

```bash
cd apps/web
pnpm remove @tanstack/react-start nitro @tanstack/react-router-ssr-query @langchain/langgraph-sdk @tanstack/ai @tanstack/ai-react @tanstack/devtools-vite
pnpm add @trpc/client@next @trpc/react-query@next
pnpm add --workspace @zaga/agent
```

- [ ] **Step 3: Rewrite `apps/web/vite.config.ts`**

```ts
import { URL, fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  envDir: '../../',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    TanStackRouterVite({ autoCodeSplitting: true }),
    tailwindcss(),
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    viteReact(),
  ],
})
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Zaga Code</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
```

- [ ] **Step 6: Remove `ssr: false` from route files and delete TanStack Start entry files**

```bash
grep -r "ssr: false" apps/web/src/routes/
```

Remove the `ssr: false` option from any `createFileRoute` calls found.

Then delete any TanStack Start bootstrapping files (not route files or components):

```bash
ls apps/web/src/client.tsx apps/web/src/router.tsx apps/web/app.config.ts 2>/dev/null
```

Delete whatever exists from that list.

- [ ] **Step 7: Run the dev server to verify SPA boots**

```bash
cd apps/web && pnpm dev
```

Open `http://localhost:3000`. Expected: app renders (API errors are fine at this point).

- [ ] **Step 8: Commit**

```bash
git add apps/web/vite.config.ts apps/web/package.json apps/web/index.html apps/web/src/main.tsx apps/web/src/routes/ pnpm-lock.yaml
git commit -m "feat(web): migrate to Vite SPA, remove TanStack Start"
```

---

## Task 8: Set up tRPC client in apps/web

**Files:**

- Modify: `apps/web/src/env.ts`
- Create: `apps/web/src/lib/trpc.ts`
- Delete: `apps/web/src/lib/ai-client.ts`
- Modify: `apps/web/src/routes/__root.tsx`

- [ ] **Step 1: Look up current docs**

Use context7 MCP: resolve `@trpc/react-query` and fetch docs on `createTRPCReact`, `splitLink`, and `httpSubscriptionLink`.

- [ ] **Step 2: Update `apps/web/src/env.ts`**

```ts
import { z } from 'zod'

const envSchema = z.object({
  VITE_AGENT_API_URL: z.url(),
})

export const env = envSchema.parse(import.meta.env)
```

Update `.env` at the repo root:

```
VITE_AGENT_API_URL=http://localhost:2024
```

- [ ] **Step 3: Create `apps/web/src/lib/trpc.ts`**

```ts
import { createTRPCReact } from '@trpc/react-query'
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client'
import type { AppRouter } from '@zaga/agent/server/router'
import { env } from '@/env'

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.type === 'subscription',
      true: httpSubscriptionLink({ url: env.VITE_AGENT_API_URL }),
      false: httpBatchLink({ url: env.VITE_AGENT_API_URL }),
    }),
  ],
})
```

- [ ] **Step 4: Delete `apps/web/src/lib/ai-client.ts`**

```bash
git rm apps/web/src/lib/ai-client.ts
```

- [ ] **Step 5: Add tRPC providers to `apps/web/src/routes/__root.tsx`**

Read the current `__root.tsx`, then wrap the existing `QueryClientProvider` with the tRPC provider:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc, trpcClient } from '@/lib/trpc'

const queryClient = new QueryClient()

// In the root component return:
<trpc.Provider client={trpcClient} queryClient={queryClient}>
  <QueryClientProvider client={queryClient}>
    {/* existing outlet / children */}
  </QueryClientProvider>
</trpc.Provider>
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/env.ts apps/web/src/lib/trpc.ts apps/web/src/routes/__root.tsx .env pnpm-lock.yaml
git commit -m "feat(web): set up tRPC client, rename env var to VITE_AGENT_API_URL"
```

---

## Task 9: Stream state reducer (raw LangGraph events)

**Files:**

- Create: `apps/web/src/hooks/streamReducer.ts`

The reducer consumes raw LangGraph `streamEvents` v2 objects as passed through from the tRPC subscription. Check the refactor branch for an existing implementation first.

- [ ] **Step 1: Check refactor branch for existing reducer**

```bash
git show refactor:apps/cli/src/state.ts 2>/dev/null || git show refactor:apps/cli/src/reducer.ts 2>/dev/null || git log --oneline refactor | head -5
```

Port the relevant logic if found. Otherwise implement from scratch:

- [ ] **Step 2: Create `apps/web/src/hooks/streamReducer.ts`**

```ts
export type ToolProgress = {
  toolCallId: string
  name: string
  input: unknown
  output: unknown
  status: 'running' | 'done'
}

export type StreamState = {
  streamingContent: string
  toolProgress: Record<string, ToolProgress>
  values: { usedTokens: number; maxTokens: number }
  error: string | null
}

// Raw LangGraph streamEvents v2 shape after JSON serialization
export type RawLangGraphEvent = {
  event: string
  name: string
  run_id: string
  data: Record<string, unknown>
  tags?: string[]
  metadata?: Record<string, unknown>
}

export type StreamAction = { type: 'event'; event: RawLangGraphEvent } | { type: 'reset' }

export const initialStreamState: StreamState = {
  streamingContent: '',
  toolProgress: {},
  values: { usedTokens: 0, maxTokens: 0 },
  error: null,
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          typeof c === 'object' && c !== null && (c as { type: string }).type === 'text'
      )
      .map(c => c.text)
      .join('')
  }
  return ''
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === 'reset') return initialStreamState

  const { event } = action

  switch (event.event) {
    case 'on_chat_model_stream': {
      const chunk = event.data?.chunk as { content?: unknown } | undefined
      const content = extractTextContent(chunk?.content)
      if (!content) return state
      return { ...state, streamingContent: state.streamingContent + content }
    }

    case 'on_tool_start': {
      const toolCallId = event.run_id
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [toolCallId]: {
            toolCallId,
            name: event.name,
            input: event.data?.input,
            output: undefined,
            status: 'running',
          },
        },
      }
    }

    case 'on_tool_end': {
      const toolCallId = event.run_id
      const existing = state.toolProgress[toolCallId]
      if (!existing) return state
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [toolCallId]: { ...existing, output: event.data?.output, status: 'done' },
        },
      }
    }

    case 'on_chain_end': {
      const output = event.data?.output as Record<string, unknown> | undefined
      if (output?.usedTokens !== undefined) {
        return {
          ...state,
          values: {
            usedTokens: output.usedTokens as number,
            maxTokens: (output.maxTokens as number) ?? state.values.maxTokens,
          },
        }
      }
      return state
    }

    default:
      return state
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/streamReducer.ts
git commit -m "feat(web): add stream reducer for raw LangGraph events"
```

---

## Task 10: useAgentStream hook

**Files:**

- Create: `apps/web/src/hooks/useAgentStream.ts`

- [ ] **Step 1: Create `apps/web/src/hooks/useAgentStream.ts`**

```ts
import { useReducer, useState, useCallback } from 'react'
import { trpc } from '@/lib/trpc'
import {
  streamReducer,
  initialStreamState,
  type ToolProgress,
  type RawLangGraphEvent,
} from './streamReducer'

export type AgentStream = {
  streamingContent: string
  toolProgress: Record<string, ToolProgress>
  values: { usedTokens: number; maxTokens: number }
  isLoading: boolean
  error: string | null
  submit: (input: string) => void
  stop: () => void
}

type PendingRun = { input: string; key: number }

export function useAgentStream(threadId: string): AgentStream {
  const [pending, setPending] = useState<PendingRun | null>(null)
  const [state, dispatch] = useReducer(streamReducer, initialStreamState)
  const cancelMutation = trpc.runs.cancel.useMutation()

  trpc.runs.stream.useSubscription(
    pending ? { threadId, input: pending.input } : { threadId, input: '' },
    {
      enabled: pending !== null,
      onData(event: RawLangGraphEvent) {
        dispatch({ type: 'event', event })
      },
      onComplete() {
        setPending(null)
      },
      onError() {
        setPending(null)
      },
    }
  )

  const submit = useCallback((input: string) => {
    dispatch({ type: 'reset' })
    setPending({ input, key: Date.now() })
  }, [])

  const stop = useCallback(() => {
    cancelMutation.mutate({ threadId })
    setPending(null)
  }, [threadId, cancelMutation])

  return {
    streamingContent: state.streamingContent,
    toolProgress: state.toolProgress,
    values: state.values,
    isLoading: pending !== null,
    error: state.error,
    submit,
    stop,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useAgentStream.ts
git commit -m "feat(web): add useAgentStream hook"
```

---

## Task 11: Update thread route

**Files:**

- Modify: `apps/web/src/routes/_layout.$threadId.tsx`

- [ ] **Step 1: Rewrite `apps/web/src/routes/_layout.$threadId.tsx`**

Read the current file first for the existing layout/scroll structure. Replace `useStream` with `useAgentStream`. The thread route reads the pending prompt from `sessionStorage` on mount and calls `stream.submit` automatically.

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'
import { messageGrouper } from '@/lib/message-grouper'
import { StreamProvider } from '@/lib/stream-context'
import { useAgentStream } from '@/hooks/useAgentStream'
import { trpc } from '@/lib/trpc'

export const Route = createFileRoute('/_layout/$threadId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { threadId } = Route.useParams()
  const stream = useAgentStream(threadId)
  const threadQuery = trpc.threads.get.useQuery({ threadId })
  const [input, setInput] = useState('')

  // Kick off graph if index route left a pending prompt in sessionStorage
  const didSubmitInitial = useRef(false)
  useEffect(() => {
    if (didSubmitInitial.current) return
    const pending = sessionStorage.getItem(`pending-prompt:${threadId}`)
    if (pending) {
      sessionStorage.removeItem(`pending-prompt:${threadId}`)
      didSubmitInitial.current = true
      stream.submit(pending)
    }
  }, [threadId]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const BOTTOM_THRESHOLD_PX = 80

  const updateStickToBottom = () => {
    const el = scrollContainerRef.current
    if (!el) return
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX
  }

  useLayoutEffect(() => {
    stickToBottomRef.current = true
  }, [threadId])

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [threadQuery.data, stream.streamingContent, stream.isLoading])

  const handleInterrupt = useCallback(() => {
    if (stream.isLoading) stream.stop()
  }, [stream])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleInterrupt()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleInterrupt])

  const historicalMessages = threadQuery.data?.messages ?? []
  const streamingMessage = stream.streamingContent
    ? [{ type: 'ai', content: stream.streamingContent }]
    : []
  const allMessages = [...historicalMessages, ...streamingMessage]

  const items = useMemo(
    () => messageGrouper(allMessages as Parameters<typeof messageGrouper>[0], stream.toolProgress),
    [allMessages, stream.toolProgress]
  )

  const usedTokens = stream.isLoading
    ? stream.values.usedTokens
    : (threadQuery.data?.usedTokens ?? 0)
  const maxTokens = stream.isLoading ? stream.values.maxTokens : (threadQuery.data?.maxTokens ?? 0)
  const contextPercent = maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 100) : null

  return (
    <StreamProvider toolProgress={stream.toolProgress}>
      <div className="w-full h-full flex flex-col justify-center items-center gap-8">
        <div
          ref={scrollContainerRef}
          onScroll={updateStickToBottom}
          className="w-full flex-1 min-h-0 overflow-y-auto"
        >
          <MessageList messages={items} />
        </div>
        <form
          onSubmit={e => {
            e.preventDefault()
            if (!input.trim() || stream.isLoading) return
            stickToBottomRef.current = true
            stream.submit(input)
            setInput('')
          }}
          className="shrink-0 w-full"
        >
          <MessageInput
            isGenerating={stream.isLoading}
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            {stream.isLoading && (
              <div className="flex items-center gap-2">
                <Loader2 className="size-3 mx-0.5 animate-spin" />
                <span className="text-xs text-muted-foreground">Working...</span>
                <p className="text-xs text-muted-foreground">
                  Press{' '}
                  <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd> to
                  interrupt
                </p>
              </div>
            )}
            {maxTokens > 0 && usedTokens > 0 && (
              <div className="ml-auto text-xs text-muted-foreground">
                {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens (
                {contextPercent}%)
              </div>
            )}
          </div>
        </form>
      </div>
    </StreamProvider>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Fix any type errors in the `messageGrouper` call if the message shape differs — cast as needed.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/_layout.\$threadId.tsx"
git commit -m "feat(web): replace useStream with useAgentStream in thread route"
```

---

## Task 12: Update index route

**Files:**

- Modify: `apps/web/src/routes/_layout.index.tsx`

On submit: create thread, store the initial prompt in `sessionStorage`, navigate. The thread route picks it up on mount and kicks off the graph.

- [ ] **Step 1: Rewrite `apps/web/src/routes/_layout.index.tsx`**

```tsx
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { trpc } from '@/lib/trpc'
import { MessageInput } from '@/components/ui/message-input'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'

const searchSchema = z.object({
  projectPath: z.string().optional(),
})

const formSchema = z.object({
  projectPath: z.string().min(1),
  initialPrompt: z.string().min(1),
})

export const Route = createFileRoute('/_layout/')({
  component: NewChat,
  validateSearch: searchSchema,
})

const STORAGE_KEY = 'agent-project-path'

function NewChat() {
  const navigate = useNavigate()
  const { projectPath: urlProjectPath } = useSearch({ from: '/_layout/' })
  const createThread = trpc.threads.create.useMutation()

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      projectPath: urlProjectPath ?? localStorage.getItem(STORAGE_KEY) ?? '',
      initialPrompt: '',
    },
    resolver: zodResolver(formSchema),
  })

  return (
    <div className="w-full h-full flex flex-col gap-10 justify-center items-center">
      <h2 className="text-3xl font-bold">Start New Chat</h2>
      <form
        onSubmit={handleSubmit(async data => {
          localStorage.setItem(STORAGE_KEY, data.projectPath)

          const { threadId } = await createThread.mutateAsync({
            projectPath: data.projectPath,
          })

          // Hand off the prompt to the thread route via sessionStorage.
          // The thread route reads it on mount and calls stream.submit automatically.
          sessionStorage.setItem(`pending-prompt:${threadId}`, data.initialPrompt)

          navigate({ to: '/$threadId', params: { threadId } })
        })}
        className="w-full max-w-xl flex flex-col gap-10"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="projectPath">Project Path</FieldLabel>
            <Input
              id="projectPath"
              type="text"
              placeholder="/path/to/your/project"
              {...register('projectPath')}
            />
            {errors.projectPath?.message && <FieldError>{errors.projectPath.message}</FieldError>}
          </Field>
        </FieldGroup>
        <MessageInput
          placeholder="Ask Zaga Code"
          isGenerating={false}
          value={watch('initialPrompt')}
          {...register('initialPrompt')}
        />
      </form>
    </div>
  )
}
```

- [ ] **Step 2: End-to-end manual test**

```bash
# Terminal 1
cd apps/agent && node --import tsx/esm src/server/index.ts 2024

# Terminal 2
cd apps/web && pnpm dev
```

1. Open `http://localhost:3000`
2. Fill project path + prompt, submit
3. Verify navigation to `/:threadId` and graph starts streaming immediately
4. Test URL prefill: `http://localhost:3000/?projectPath=/tmp/test`

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/_layout.index.tsx"
git commit -m "feat(web): update index route with sessionStorage handoff"
```

---

## Task 13: Create apps/desktop package scaffold

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/electron-builder.config.cjs`

- [ ] **Step 1: Look up current docs**

Use context7 MCP: resolve `electron` and `electron-builder`, fetch docs on main process setup and `electron-rebuild` for native modules.

- [ ] **Step 2: Create `apps/desktop/package.json`**

```json
{
  "name": "@zaga/desktop",
  "private": true,
  "version": "0.0.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "electron --import tsx/esm src/main.ts",
    "build": "tsc && electron-builder",
    "rebuild": "electron-rebuild"
  },
  "dependencies": {
    "@zaga/agent": "workspace:*",
    "sirv": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-rebuild": "^3.2.9",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Install and rebuild**

```bash
cd apps/desktop
pnpm install
pnpm rebuild
```

- [ ] **Step 4: Create `apps/desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `apps/desktop/electron-builder.config.cjs`**

```js
module.exports = {
  appId: 'com.zaga.code',
  productName: 'Zaga Code',
  directories: { output: 'release' },
  files: ['dist/**/*', 'node_modules/**/*'],
  extraResources: [{ from: '../web/dist', to: 'web' }],
  mac: { category: 'public.app-category.developer-tools' },
  linux: { category: 'Development' },
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/
git commit -m "feat(desktop): scaffold Electron package"
```

---

## Task 14: Implement server management

**Files:**

- Create: `apps/desktop/src/servers.ts`

- [ ] **Step 1: Create `apps/desktop/src/servers.ts`**

```ts
import { startAgentServer } from '@zaga/agent/server'
import http from 'node:http'
import { join } from 'node:path'
import sirv from 'sirv'

export const AGENT_PORT = 2024
export const WEB_PORT = 3000

export async function startServers(webDistPath: string) {
  await startAgentServer(AGENT_PORT)

  const serve = sirv(webDistPath, { single: true })
  const webServer = http.createServer(serve)
  webServer.listen(WEB_PORT)
  console.log(`Web UI server listening on :${WEB_PORT}`)
}

export function getWebDistPath(): string {
  if (process.env.ELECTRON_IS_PACKAGED) {
    return join(process.resourcesPath, 'web')
  }
  return join(__dirname, '../../web/dist')
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop && pnpm exec tsc --noEmit
```

If `@zaga/agent/server` isn't resolved, verify `apps/agent/package.json` has `"./server": "./src/server/index.ts"` in its exports.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/servers.ts
git commit -m "feat(desktop): add server management module"
```

---

## Task 15: Implement Electron main process

**Files:**

- Create: `apps/desktop/src/main.ts`

`path.resolve()` handles both absolute and relative project paths — relative paths are resolved from the working directory at the time the CLI runs.

- [ ] **Step 1: Create `apps/desktop/src/main.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { setup } from '@zaga/agent/setup'
import { startServers, getWebDistPath, AGENT_PORT, WEB_PORT } from './servers.js'

const IS_DEV = !app.isPackaged

function getProjectPathFromArgs(argv: string[]): string | null {
  // Skip electron binary and main script; find the first non-flag argument
  const arg = argv.slice(IS_DEV ? 2 : 1).find(a => !a.startsWith('--'))
  return arg ? resolve(arg) : null // resolve() handles relative and absolute paths
}

function buildUrl(projectPath: string | null): string {
  const base = IS_DEV ? `http://localhost:5173` : `http://localhost:${WEB_PORT}`
  return projectPath ? `${base}/?projectPath=${encodeURIComponent(projectPath)}` : base
}

let mainWindow: BrowserWindow | null = null

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  mainWindow.loadURL(url)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function main() {
  const projectPath = getProjectPathFromArgs(process.argv)

  const gotLock = app.requestSingleInstanceLock({ projectPath })
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', (_event, _argv, _cwd, data) => {
    const { projectPath: incomingPath } = data as { projectPath: string | null }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.loadURL(buildUrl(incomingPath))
    }
  })

  await app.whenReady()

  await setup({ logLevel: 'verbose' })

  if (IS_DEV) {
    const { startAgentServer } = await import('@zaga/agent/server')
    await startAgentServer(AGENT_PORT)
  } else {
    await startServers(getWebDistPath())
  }

  createWindow(buildUrl(projectPath))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(buildUrl(null))
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

main().catch(err => {
  console.error('Startup error:', err)
  app.quit()
})
```

- [ ] **Step 2: Run the app in development**

Ensure Vite is running:

```bash
# Terminal 1
cd apps/web && pnpm dev
```

Start Electron:

```bash
# Terminal 2
cd apps/desktop && pnpm dev
```

Expected: Electron window opens, loads `localhost:5173`, agent starts on `:2024`.

- [ ] **Step 3: Test single-instance with both absolute and relative paths**

While the Electron app is running, open a second terminal:

```bash
# Absolute path
cd apps/desktop && pnpm dev /tmp/test-project

# Relative path
cd /tmp && node /path/to/apps/desktop/bin/zaga test-project
```

Expected in both cases: existing window focuses and navigates to `/?projectPath=...`, no second window opens.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): implement Electron main process with single-instance lock"
```

---

## Task 16: Create zaga CLI launcher + root scripts

**Files:**

- Create: `apps/desktop/bin/zaga`
- Modify: `package.json` (root)

- [ ] **Step 1: Create `apps/desktop/bin/zaga`**

```bash
mkdir -p apps/desktop/bin
```

Create `apps/desktop/bin/zaga`:

```sh
#!/usr/bin/env sh
# Usage: zaga [path/to/project]
# Both absolute and relative paths are supported.
DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec npx electron --import tsx/esm "$DESKTOP_DIR/src/main.ts" "$@"
```

Make executable:

```bash
chmod +x apps/desktop/bin/zaga
```

- [ ] **Step 2: Add scripts to root `package.json`**

Add to the `"scripts"` field:

```json
"desktop:dev": "pnpm --filter @zaga/desktop dev",
"desktop:build": "pnpm --filter web build && pnpm --filter @zaga/desktop build"
```

- [ ] **Step 3: Test the CLI**

```bash
# No path
apps/desktop/bin/zaga

# Absolute path
apps/desktop/bin/zaga /tmp/my-project

# Relative path
cd /tmp && /path/to/repo/apps/desktop/bin/zaga my-project
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/bin/zaga package.json
git commit -m "feat(desktop): add zaga CLI launcher and root build scripts"
```

---

## Spec Coverage

- [x] CLI invocation (`zaga /path`, relative + absolute) — Tasks 15–16
- [x] No manual startup — Task 15 (`setup()` + server start in `main()`)
- [x] Web UI accessible on LAN (`:3000`) — Task 14
- [x] No LangGraph SDK in web — Tasks 7–12
- [x] Typed contract via `AppRouter` — Tasks 3–6, Task 8
- [x] SQLite checkpointer at `~/.zaga/history.db` — Task 1
- [x] `settings.json` replaces `.env` with Zod defaults — Task 2
- [x] `projectPath` from URL query param — Tasks 12, 15
- [x] Raw stream pass-through (no server-side event mapping) — Task 5
- [x] Frontend handles all event processing — Tasks 9–11
- [x] Single-instance Electron lock — Task 15
- [x] `sessionStorage` handoff for initial prompt — Tasks 11–12
