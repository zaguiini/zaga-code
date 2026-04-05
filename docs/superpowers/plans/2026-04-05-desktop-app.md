# Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the project into a self-contained Electron desktop app: the agent runs as a tRPC HTTP server, the React SPA is served statically, everything starts automatically, and `zaga /path` opens a new session from the CLI.

**Architecture:** Electron main process starts a tRPC server on `:2024` (LangGraph agent + SQLite checkpointer) and a static file server on `:3000` (Vite SPA). The web UI uses `@trpc/react-query` — no LangGraph SDK. The `AppRouter` type from `apps/agent` is the shared contract.

**Tech Stack:** Electron 33, tRPC v11, `@trpc/react-query`, `@langchain/langgraph-checkpoint-sqlite`, `better-sqlite3`, `sirv`, TanStack Router (SPA), Vite 7, TypeScript

**Reference:** The `refactor` branch (`git show refactor:apps/...`) has a working SQLite checkpointer and streaming state reducer in `apps/cli`. Port from there rather than rebuilding.

---

## File Map

**New files:**

- `apps/agent/src/db.ts` — SQLite connection + threads metadata table
- `apps/agent/src/checkpointer.ts` — `SqliteSaver` instance
- `apps/agent/src/provider.ts` — reads `~/.zaga/settings.json`, returns model config
- `apps/agent/src/server/trpc.ts` — tRPC init + context type
- `apps/agent/src/server/router.ts` — `appRouter` + exported `AppRouter` type
- `apps/agent/src/server/index.ts` — starts HTTP server, exports `startAgentServer`
- `apps/web/src/main.tsx` — SPA entry point (replaces TanStack Start entry)
- `apps/web/index.html` — Vite SPA root HTML
- `apps/web/src/lib/trpc.ts` — typed tRPC client + React provider setup
- `apps/web/src/hooks/streamReducer.ts` — pure reducer for SSE stream events
- `apps/web/src/hooks/useAgentStream.ts` — hook wrapping tRPC subscription + reducer
- `apps/desktop/package.json`
- `apps/desktop/tsconfig.json`
- `apps/desktop/electron-builder.config.cjs`
- `apps/desktop/src/main.ts` — Electron main process
- `apps/desktop/src/servers.ts` — starts `:2024` and `:3000` servers
- `apps/desktop/src/setup.ts` — provider/model initialization
- `apps/desktop/bin/zaga` — CLI launcher script

**Modified files:**

- `apps/agent/src/graphs/agent.ts` — accept checkpointer in `createAgent()`
- `apps/agent/src/setup.ts` — skip lms when provider config has `apiKey`
- `apps/agent/src/env.ts` — make `MODEL`/`MODEL_API_BASE_URL` optional
- `apps/agent/package.json` — add tRPC + SQLite deps, add server export
- `apps/web/vite.config.ts` — remove TanStack Start/Nitro, pure Vite SPA
- `apps/web/src/env.ts` — rename `VITE_LANGGRAPH_API_URL` → `VITE_AGENT_API_URL`
- `apps/web/src/routes/__root.tsx` — add tRPC provider
- `apps/web/src/routes/_layout.$threadId.tsx` — replace `useStream` with `useAgentStream`
- `apps/web/src/routes/_layout.index.tsx` — read `projectPath` from URL, use tRPC
- `apps/web/package.json` — remove TanStack Start/langgraph-sdk, add tRPC
- `pnpm-workspace.yaml` — add `packages/*` alongside `apps/*`
- `package.json` (root) — add `desktop:dev` and `desktop:build` scripts

**Deleted files:**

- `apps/web/src/lib/ai-client.ts` — replaced by tRPC client

---

## Task 1: Add SQLite persistence to apps/agent

**Files:**

- Create: `apps/agent/src/db.ts`
- Create: `apps/agent/src/checkpointer.ts`
- Modify: `apps/agent/package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd apps/agent
pnpm add @langchain/langgraph-checkpoint-sqlite better-sqlite3
pnpm add -D @types/better-sqlite3
```

Expected: packages added to `apps/agent/package.json`.

- [ ] **Step 2: Create the DB module**

Create `apps/agent/src/db.ts`:

```ts
import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const dbDir = join(homedir(), '.zaga')
mkdirSync(dbDir, { recursive: true })

export const dbPath = join(dbDir, 'history.db')

export const db = new Database(dbPath)

// Enable WAL mode for concurrent access
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    thread_id   TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_message TEXT
  )
`)
```

- [ ] **Step 3: Create the checkpointer module**

Create `apps/agent/src/checkpointer.ts`:

```ts
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { dbPath } from './db.js'

export const checkpointer = SqliteSaver.fromConnString(dbPath)
```

- [ ] **Step 4: Smoke test — verify DB is created**

```bash
cd apps/agent
node --import tsx/esm -e "import('./src/db.js')"
ls ~/.zaga/history.db
```

Expected: file exists at `~/.zaga/history.db`.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/db.ts apps/agent/src/checkpointer.ts apps/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): add SQLite DB and checkpointer modules"
```

---

## Task 2: Provider configuration

**Files:**

- Create: `apps/agent/src/provider.ts`
- Modify: `apps/agent/src/env.ts`
- Modify: `apps/agent/src/graphs/agent.ts`
- Modify: `apps/agent/src/setup.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/agent/src/provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}))

import { readFileSync } from 'node:fs'
import { resolveProviderConfig } from './provider.js'

describe('resolveProviderConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns lmStudio when settings.json has no apiKey', () => {
    vi.mocked(readFileSync).mockReturnValue('{}')
    expect(resolveProviderConfig()).toEqual({ type: 'lmStudio' })
  })

  it('returns openaiCompat when settings.json has apiKey + model', () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ apiKey: 'sk-test', model: 'gpt-4o' }))
    expect(resolveProviderConfig()).toEqual({
      type: 'openaiCompat',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      apiBase: 'https://api.openai.com/v1',
    })
  })

  it('uses custom apiBase when provided', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ apiKey: 'key', model: 'llama', apiBase: 'http://localhost:11434/v1' })
    )
    const config = resolveProviderConfig()
    expect(config).toMatchObject({ apiBase: 'http://localhost:11434/v1' })
  })

  it('returns lmStudio when settings.json is missing', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(resolveProviderConfig()).toEqual({ type: 'lmStudio' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agent
pnpm exec vitest run src/provider.test.ts
```

Expected: FAIL — `resolveProviderConfig` not found.

- [ ] **Step 3: Create `apps/agent/src/provider.ts`**

```ts
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type LmStudioConfig = { type: 'lmStudio' }

type OpenAiCompatConfig = {
  type: 'openaiCompat'
  apiKey: string
  model: string
  apiBase: string
}

export type ProviderConfig = LmStudioConfig | OpenAiCompatConfig

export function resolveProviderConfig(): ProviderConfig {
  try {
    const raw = readFileSync(join(homedir(), '.zaga', 'settings.json'), 'utf-8')
    const settings = JSON.parse(raw) as Record<string, unknown>

    if (typeof settings.apiKey === 'string' && typeof settings.model === 'string') {
      return {
        type: 'openaiCompat',
        apiKey: settings.apiKey,
        model: settings.model,
        apiBase:
          typeof settings.apiBase === 'string' ? settings.apiBase : 'https://api.openai.com/v1',
      }
    }
  } catch {
    // file missing or invalid JSON — fall through to lmStudio
  }

  return { type: 'lmStudio' }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run src/provider.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Update `apps/agent/src/env.ts` to make MODEL/MODEL_API_BASE_URL optional**

Read the current file first, then change it so `MODEL` and `MODEL_API_BASE_URL` are optional (they're only needed for the lmStudio path):

```ts
import { z } from 'zod'

const envSchema = z.object({
  MODEL: z.string().optional(),
  MODEL_API_BASE_URL: z.url().optional(),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 6: Update `apps/agent/src/graphs/agent.ts` — `createModel()` uses provider config**

Replace the `createModel()` function (currently hardcodes `env.MODEL`):

```ts
import { resolveProviderConfig } from '../provider.js'

export function createModel() {
  const config = resolveProviderConfig()

  if (config.type === 'openaiCompat') {
    return new ChatOpenAIWithReasoning({
      model: config.model,
      configuration: { baseURL: config.apiBase },
      apiKey: config.apiKey,
      temperature: 0.3,
      streaming: true,
      streamUsage: true,
    })
  }

  // lmStudio — falls back to env vars (existing behaviour)
  return new ChatOpenAIWithReasoning({
    model: env.MODEL!,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.3,
    streaming: true,
    streamUsage: true,
  })
}
```

- [ ] **Step 7: Update `createAgent()` to accept an optional checkpointer**

In `apps/agent/src/graphs/agent.ts`, update `createAgent()`:

```ts
import type { BaseCheckpointSaver } from '@langchain/langgraph'

export async function createAgent(opts: { checkpointer?: BaseCheckpointSaver } = {}) {
  const maxTokens = await queryMaxTokens()
  const graph = buildAgentGraph({ maxTokens })
  return graph.compile({ checkpointer: opts.checkpointer })
}
```

- [ ] **Step 8: Update `apps/agent/src/setup.ts` — skip lms when apiKey present**

In the `setup()` function, add a guard at the top:

```ts
import { resolveProviderConfig } from './provider.js'

export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  logLevel = options.logLevel ?? 'silent'

  const providerConfig = resolveProviderConfig()

  if (providerConfig.type === 'openaiCompat') {
    // No lmStudio setup needed
    return {
      model: {
        id: providerConfig.model,
        maxTokens: 128000, // reasonable default; refine later
      },
    }
  }

  // existing lmStudio flow below...
  try {
    await setupLmStudioModel()
    // ...
```

Also update `queryMaxTokens()` in `apps/agent/src/graphs/agent.ts` to handle the non-lmStudio case:

```ts
async function queryMaxTokens(): Promise<number> {
  const config = resolveProviderConfig()
  if (config.type === 'openaiCompat') return 128000
  const info = await queryModelInfo(env.MODEL!)
  return info.maxTokens
}
```

- [ ] **Step 9: Commit**

```bash
git add apps/agent/src/provider.ts apps/agent/src/provider.test.ts apps/agent/src/env.ts apps/agent/src/graphs/agent.ts apps/agent/src/setup.ts
git commit -m "feat(agent): add provider config, skip lms when apiKey present"
```

---

## Task 3: Set up tRPC in apps/agent

**Files:**

- Create: `apps/agent/src/server/trpc.ts`
- Create: `apps/agent/src/server/router.ts` (scaffold)
- Modify: `apps/agent/package.json`

- [ ] **Step 1: Install tRPC**

```bash
cd apps/agent
pnpm add @trpc/server@next
```

Expected: `@trpc/server` v11 added.

- [ ] **Step 2: Create `apps/agent/src/server/trpc.ts`**

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

- [ ] **Step 3: Scaffold `apps/agent/src/server/router.ts`**

```ts
import { router } from './trpc.js'

export const appRouter = router({})

export type AppRouter = typeof appRouter
```

- [ ] **Step 4: Add server export to `apps/agent/package.json`**

In the `"exports"` field, add:

```json
"./server": "./src/server/index.ts",
"./server/router": "./src/server/router.ts"
```

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/server/ apps/agent/package.json pnpm-lock.yaml
git commit -m "feat(agent): scaffold tRPC server"
```

---

## Task 4: Implement threads procedures

**Files:**

- Modify: `apps/agent/src/server/router.ts`

- [ ] **Step 1: Implement `threads.create`, `threads.list`, `threads.get`**

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
cd apps/agent
pnpm exec tsc --noEmit
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/server/router.ts
git commit -m "feat(agent): implement threads tRPC procedures"
```

---

## Task 5: Implement runs procedures

**Files:**

- Modify: `apps/agent/src/server/router.ts`

The `runs.stream` subscription maps LangGraph's `streamEvents` output to our typed `StreamEvent` discriminated union. A `Map<threadId, AbortController>` enables cancellation.

- [ ] **Step 1: Add the runs router to `apps/agent/src/server/router.ts`**

Add at the top of the file after imports:

```ts
import { BaseMessage } from '@langchain/core/messages'

type StreamEvent =
  | { type: 'message_chunk'; content: string; role: 'assistant' }
  | { type: 'tool_start'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_end'; toolCallId: string; output: unknown }
  | { type: 'values'; usedTokens: number; maxTokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

const abortControllers = new Map<string, AbortController>()
```

Then add the `runsRouter`:

```ts
const runsRouter = router({
  stream: procedure
    .input(z.object({ threadId: z.string(), input: z.string(), _key: z.number().optional() }))
    .subscription(async function* ({ input, ctx }) {
      const { threadId, input: userInput } = input

      const ac = new AbortController()
      abortControllers.set(threadId, ac)

      try {
        const eventStream = ctx.graph.streamEvents(
          {
            messages: [{ type: 'human', content: [{ type: 'text', text: userInput }] }],
          },
          {
            version: 'v2',
            configurable: { thread_id: threadId },
            signal: ac.signal,
          }
        )

        for await (const event of eventStream) {
          if (event.event === 'on_chat_model_stream') {
            const chunk = event.data?.chunk
            const content =
              typeof chunk?.content === 'string'
                ? chunk.content
                : Array.isArray(chunk?.content)
                  ? chunk.content
                      .filter((c: { type: string }) => c.type === 'text')
                      .map((c: { text: string }) => c.text)
                      .join('')
                  : ''
            if (content) {
              const ev: StreamEvent = { type: 'message_chunk', content, role: 'assistant' }
              yield ev
            }
          } else if (event.event === 'on_tool_start') {
            const ev: StreamEvent = {
              type: 'tool_start',
              toolCallId: (event.run_id as string) ?? '',
              name: event.name ?? '',
              input: event.data?.input,
            }
            yield ev
          } else if (event.event === 'on_tool_end') {
            const ev: StreamEvent = {
              type: 'tool_end',
              toolCallId: (event.run_id as string) ?? '',
              output: event.data?.output,
            }
            yield ev
          } else if (event.event === 'on_chain_end' && event.name === 'executor') {
            const values = event.data?.output as Record<string, unknown> | undefined
            if (values?.usedTokens !== undefined) {
              const ev: StreamEvent = {
                type: 'values',
                usedTokens: values.usedTokens as number,
                maxTokens: values.maxTokens as number,
              }
              yield ev
            }
          }
        }

        // Update last_message in threads table
        db.prepare('UPDATE threads SET last_message = ? WHERE thread_id = ?').run(
          userInput.slice(0, 100),
          threadId
        )

        yield { type: 'done' } as StreamEvent
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          yield { type: 'error', message: (err as Error).message } as StreamEvent
        }
      } finally {
        abortControllers.delete(threadId)
      }
    }),

  cancel: procedure.input(z.object({ threadId: z.string() })).mutation(({ input }) => {
    const ac = abortControllers.get(input.threadId)
    if (ac) ac.abort()
    return { ok: true }
  }),
})
```

Update the exported `appRouter` to include both routers:

```ts
export const appRouter = router({
  threads: threadsRouter,
  runs: runsRouter,
})
export type AppRouter = typeof appRouter
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/agent
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/server/router.ts
git commit -m "feat(agent): implement runs.stream subscription and runs.cancel"
```

---

## Task 6: Create agent HTTP server entry point

**Files:**

- Create: `apps/agent/src/server/index.ts`
- Modify: `apps/agent/package.json`

- [ ] **Step 1: Install standalone adapter**

```bash
cd apps/agent
pnpm add @trpc/server@next
```

The standalone adapter ships with `@trpc/server` — no extra install needed.

- [ ] **Step 2: Create `apps/agent/src/server/index.ts`**

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

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/agent
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test — start the server manually**

```bash
cd apps/agent
node --import tsx/esm -e "
import { startAgentServer } from './src/server/index.js'
startAgentServer(2024).then(() => console.log('ok'))
"
```

Expected: `Agent tRPC server listening on :2024` printed. Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/server/index.ts apps/agent/package.json
git commit -m "feat(agent): add HTTP server entry point"
```

---

## Task 7: Migrate apps/web to Vite SPA

**Files:**

- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`

The current `apps/web` uses TanStack Start (SSR). We strip it to a plain Vite SPA. Routes stay the same — TanStack Router works identically in SPA mode.

- [ ] **Step 1: Update `apps/web/package.json` — remove SSR deps, add tRPC**

Remove from `dependencies`: `@tanstack/react-start`, `nitro`, `@tanstack/react-router-ssr-query`, `@langchain/langgraph-sdk`, `@tanstack/ai`, `@tanstack/ai-react`.

Remove from `devDependencies`: `@tanstack/devtools-vite`.

Add to `dependencies`:

```json
"@trpc/client": "next",
"@trpc/react-query": "next",
"@zaga/agent": "workspace:*"
```

Run:

```bash
cd apps/web
pnpm remove @tanstack/react-start nitro @tanstack/react-router-ssr-query @langchain/langgraph-sdk @tanstack/ai @tanstack/ai-react @tanstack/devtools-vite
pnpm add @trpc/client@next @trpc/react-query@next
pnpm add --workspace @zaga/agent
```

- [ ] **Step 2: Rewrite `apps/web/vite.config.ts`**

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

- [ ] **Step 3: Create `apps/web/index.html`**

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

- [ ] **Step 4: Create `apps/web/src/main.tsx`**

Check what the current router setup file looks like (it may be `src/router.tsx` or `src/client.tsx`), then create a standard SPA entry:

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

- [ ] **Step 5: Remove `ssr: false` from route files**

In `apps/web/src/routes/_layout.index.tsx`, remove the `ssr: false` option from `createFileRoute`:

Change:

```ts
export const Route = createFileRoute('/_layout/')({
  component: NewChat,
  ssr: false,
})
```

To:

```ts
export const Route = createFileRoute('/_layout/')({
  component: NewChat,
})
```

Do the same for any other route that has `ssr: false`.

- [ ] **Step 6: Run dev server to verify SPA boots**

```bash
cd apps/web
pnpm dev
```

Open `http://localhost:3000` in a browser. Expected: the app loads (even if API calls fail — the UI should render).

- [ ] **Step 7: Commit**

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

- [ ] **Step 1: Update `apps/web/src/env.ts`**

```ts
import { z } from 'zod'

const envSchema = z.object({
  VITE_AGENT_API_URL: z.url(),
})

export const env = envSchema.parse(import.meta.env)
```

Update (or create) `.env` at the repo root:

```
VITE_AGENT_API_URL=http://localhost:2024
```

- [ ] **Step 2: Create `apps/web/src/lib/trpc.ts`**

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

- [ ] **Step 3: Delete `apps/web/src/lib/ai-client.ts`**

```bash
rm apps/web/src/lib/ai-client.ts
```

- [ ] **Step 4: Add tRPC providers to `apps/web/src/routes/__root.tsx`**

Read the current `__root.tsx`, then wrap the existing `QueryClientProvider` with the tRPC provider. The structure should be:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { trpc, trpcClient } from '@/lib/trpc'

const queryClient = new QueryClient()

// Inside the root component:
<trpc.Provider client={trpcClient} queryClient={queryClient}>
  <QueryClientProvider client={queryClient}>
    {/* existing children */}
  </QueryClientProvider>
</trpc.Provider>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/web
pnpm exec tsc --noEmit
```

Expected: no errors (some may appear from route files that still reference the old SDK — those will be fixed in later tasks).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/env.ts apps/web/src/lib/trpc.ts apps/web/src/routes/__root.tsx .env pnpm-lock.yaml
git commit -m "feat(web): add tRPC client, rename env var to VITE_AGENT_API_URL"
```

---

## Task 9: Stream state reducer

**Files:**

- Create: `apps/web/src/hooks/streamReducer.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/streamReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { streamReducer, initialStreamState } from './streamReducer'
import type { StreamAction } from './streamReducer'

describe('streamReducer', () => {
  it('accumulates message_chunk events into a single message', () => {
    let state = streamReducer(initialStreamState, {
      type: 'event',
      event: { type: 'message_chunk', content: 'Hello', role: 'assistant' },
    })
    state = streamReducer(state, {
      type: 'event',
      event: { type: 'message_chunk', content: ' world', role: 'assistant' },
    })
    expect(state.streamingContent).toBe('Hello world')
  })

  it('adds tool_start to toolProgress', () => {
    const state = streamReducer(initialStreamState, {
      type: 'event',
      event: { type: 'tool_start', toolCallId: 'abc', name: 'file_read', input: { path: '/foo' } },
    })
    expect(state.toolProgress['abc']).toEqual({
      toolCallId: 'abc',
      name: 'file_read',
      input: { path: '/foo' },
      output: undefined,
      status: 'running',
    })
  })

  it('updates tool output on tool_end', () => {
    let state = streamReducer(initialStreamState, {
      type: 'event',
      event: { type: 'tool_start', toolCallId: 'abc', name: 'file_read', input: {} },
    })
    state = streamReducer(state, {
      type: 'event',
      event: { type: 'tool_end', toolCallId: 'abc', output: 'file contents' },
    })
    expect(state.toolProgress['abc'].status).toBe('done')
    expect(state.toolProgress['abc'].output).toBe('file contents')
  })

  it('updates values on values event', () => {
    const state = streamReducer(initialStreamState, {
      type: 'event',
      event: { type: 'values', usedTokens: 100, maxTokens: 8000 },
    })
    expect(state.values).toEqual({ usedTokens: 100, maxTokens: 8000 })
  })

  it('resets streaming content on reset', () => {
    let state = streamReducer(initialStreamState, {
      type: 'event',
      event: { type: 'message_chunk', content: 'Hi', role: 'assistant' },
    })
    state = streamReducer(state, { type: 'reset' })
    expect(state.streamingContent).toBe('')
    expect(state.toolProgress).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
pnpm exec vitest run src/hooks/streamReducer.test.ts
```

Expected: FAIL — `streamReducer` not found.

- [ ] **Step 3: Create `apps/web/src/hooks/streamReducer.ts`**

```ts
export type ToolProgress = {
  toolCallId: string
  name: string
  input: unknown
  output: unknown
  status: 'running' | 'done'
}

type StreamEvent =
  | { type: 'message_chunk'; content: string; role: 'assistant' }
  | { type: 'tool_start'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_end'; toolCallId: string; output: unknown }
  | { type: 'values'; usedTokens: number; maxTokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type StreamState = {
  streamingContent: string
  toolProgress: Record<string, ToolProgress>
  values: { usedTokens: number; maxTokens: number }
  error: string | null
}

export type StreamAction = { type: 'event'; event: StreamEvent } | { type: 'reset' }

export const initialStreamState: StreamState = {
  streamingContent: '',
  toolProgress: {},
  values: { usedTokens: 0, maxTokens: 0 },
  error: null,
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === 'reset') return initialStreamState

  const { event } = action

  switch (event.type) {
    case 'message_chunk':
      return { ...state, streamingContent: state.streamingContent + event.content }

    case 'tool_start':
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [event.toolCallId]: {
            toolCallId: event.toolCallId,
            name: event.name,
            input: event.input,
            output: undefined,
            status: 'running',
          },
        },
      }

    case 'tool_end':
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [event.toolCallId]: {
            ...state.toolProgress[event.toolCallId],
            output: event.output,
            status: 'done',
          },
        },
      }

    case 'values':
      return { ...state, values: { usedTokens: event.usedTokens, maxTokens: event.maxTokens } }

    case 'error':
      return { ...state, error: event.message }

    default:
      return state
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run src/hooks/streamReducer.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/streamReducer.ts apps/web/src/hooks/streamReducer.test.ts
git commit -m "feat(web): add stream state reducer"
```

---

## Task 10: useAgentStream hook

**Files:**

- Create: `apps/web/src/hooks/useAgentStream.ts`

- [ ] **Step 1: Create `apps/web/src/hooks/useAgentStream.ts`**

```ts
import { useReducer, useState, useCallback } from 'react'
import { trpc } from '@/lib/trpc'
import { streamReducer, initialStreamState, type ToolProgress } from './streamReducer'

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
    pending ? { threadId, input: pending.input, _key: pending.key } : ({ enabled: false } as never),
    {
      enabled: pending !== null,
      onData(event) {
        if (event.type === 'done') {
          setPending(null)
        } else {
          dispatch({ type: 'event', event })
        }
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
cd apps/web
pnpm exec tsc --noEmit
```

Expected: no errors in the new hook file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useAgentStream.ts
git commit -m "feat(web): add useAgentStream hook"
```

---

## Task 11: Update thread route

**Files:**

- Modify: `apps/web/src/routes/_layout.$threadId.tsx`

Replace the entire file. Read the current version first to understand the existing layout/scroll logic, then rewrite to use `useAgentStream`. The UI components (`MessageList`, `MessageInput`, etc.) stay unchanged.

- [ ] **Step 1: Rewrite `apps/web/src/routes/_layout.$threadId.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

  // Load persisted messages from thread history
  const threadQuery = trpc.threads.get.useQuery({ threadId })

  const [input, setInput] = useState('')

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const BOTTOM_THRESHOLD_PX = 80

  const updateStickToBottom = () => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX
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
    if (!stream.isLoading) return
    stream.stop()
  }, [stream])

  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleInterrupt()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleInterrupt])

  // Build display messages: persisted history + current streaming content
  const historicalMessages = threadQuery.data?.messages ?? []
  const streamingMessage = stream.streamingContent
    ? [{ type: 'ai', content: stream.streamingContent }]
    : []
  const allMessages = [...historicalMessages, ...streamingMessage]

  const items = useMemo(
    () => messageGrouper(allMessages as Parameters<typeof messageGrouper>[0], stream.toolProgress),
    [allMessages, stream.toolProgress]
  )

  const values = stream.isLoading ? stream.values : (threadQuery.data ?? stream.values)
  const usedTokens = (values as { usedTokens?: number }).usedTokens ?? 0
  const maxTokens = (values as { maxTokens?: number }).maxTokens ?? 0
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
              <div className="flex items-center justify-center gap-2">
                <div className="flex items-center justify-center gap-0.5">
                  <Loader2 className="size-3 mx-0.5 animate-spin" />
                  <span className="text-xs text-muted-foreground text-center">Working...</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Press{' '}
                  <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd> to
                  interrupt
                </p>
              </div>
            )}
            {maxTokens > 0 && usedTokens > 0 && (
              <div className="ml-auto flex items-center justify-end text-xs text-muted-foreground">
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
cd apps/web
pnpm exec tsc --noEmit
```

Fix any type errors before continuing. Common issue: `messageGrouper` may expect a specific message type — cast as needed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_layout.\$threadId.tsx
git commit -m "feat(web): replace useStream with useAgentStream in thread route"
```

---

## Task 12: Update index route (projectPath from URL)

**Files:**

- Modify: `apps/web/src/routes/_layout.index.tsx`

The new index route reads `?projectPath=` from the URL to prefill the project path input. Thread creation calls `trpc.threads.create`. After creation, it navigates to `/:threadId` and calls `stream.submit`.

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

          await navigate({
            to: '/$threadId',
            params: { threadId },
            state: { initialPrompt: data.initialPrompt },
          })
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

Note: the `initialPrompt` is passed as router state to the thread route. Update the thread route to read `Route.useMatch().state?.initialPrompt` and call `stream.submit(initialPrompt)` on mount if present.

Add to the top of `RouteComponent` in `_layout.$threadId.tsx`:

```ts
const { state } = Route.useMatch()
const initialPromptRef = useRef<string | null>(
  (state as { initialPrompt?: string })?.initialPrompt ?? null
)

useEffect(() => {
  if (initialPromptRef.current) {
    stream.submit(initialPromptRef.current)
    initialPromptRef.current = null
  }
}, []) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Manual test — open web app and create a thread**

Start the agent server in one terminal:

```bash
cd apps/agent
node --import tsx/esm src/server/index.ts 2024
```

Start the web app in another:

```bash
cd apps/web
pnpm dev
```

Open `http://localhost:3000`, fill in a project path and prompt, submit. Verify it navigates to `/:threadId`.

Also test URL prefill: `http://localhost:3000/new?projectPath=/tmp/test` — the project path field should be prefilled.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_layout.index.tsx apps/web/src/routes/_layout.\$threadId.tsx
git commit -m "feat(web): update index route to read projectPath from URL, use tRPC for thread creation"
```

---

## Task 13: Create apps/desktop package scaffold

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/electron-builder.config.cjs`

- [ ] **Step 1: Update `pnpm-workspace.yaml` to include packages dir (for future use)**

The file currently has:

```yaml
packages:
  - 'apps/*'
```

No change needed — `apps/desktop` is already covered.

- [ ] **Step 2: Create `apps/desktop/package.json`**

```json
{
  "name": "@zaga/desktop",
  "private": true,
  "version": "0.0.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx src/main.ts",
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

- [ ] **Step 3: Install dependencies**

```bash
cd apps/desktop
pnpm install
```

After install, rebuild native modules for Electron:

```bash
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
- Create: `apps/desktop/src/setup.ts`

- [ ] **Step 1: Create `apps/desktop/src/setup.ts`**

```ts
import { setup, type SetupResult } from '@zaga/agent/setup'

export async function initializeProvider(): Promise<SetupResult> {
  console.log('Initializing provider...')
  const result = await setup({ logLevel: 'verbose' })
  console.log(`Provider ready: ${result.model.id}`)
  return result
}
```

- [ ] **Step 2: Create `apps/desktop/src/servers.ts`**

```ts
import { startAgentServer } from '@zaga/agent/server'
import http from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import sirv from 'sirv'

const AGENT_PORT = 2024
const WEB_PORT = 3000

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

export async function startServers(webDistPath: string) {
  // Agent tRPC server
  await startAgentServer(AGENT_PORT)

  // Web static file server (SPA fallback)
  const serve = sirv(webDistPath, { single: true, dev: false })
  const webServer = http.createServer(serve)
  webServer.listen(WEB_PORT)
  console.log(`Web UI server listening on :${WEB_PORT}`)

  return { agentPort: AGENT_PORT, webPort: WEB_PORT }
}

export function getWebDistPath(app: Electron.App): string {
  // In production: extraResources puts web dist at resources/web
  // In development: use the Vite dev server URL instead
  if (app.isPackaged) {
    return join(process.resourcesPath, 'web')
  }
  // dev: caller should use Vite dev server directly
  return join(__dirname, '../../web/dist')
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/desktop
pnpm exec tsc --noEmit
```

Fix any import errors. If `@zaga/agent/setup` and `@zaga/agent/server` aren't resolved, verify `apps/agent/package.json` exports include those paths.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/setup.ts apps/desktop/src/servers.ts
git commit -m "feat(desktop): add server and provider setup modules"
```

---

## Task 15: Implement Electron main process

**Files:**

- Create: `apps/desktop/src/main.ts`

- [ ] **Step 1: Create `apps/desktop/src/main.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initializeProvider } from './setup.js'
import { startServers, getWebDistPath } from './servers.js'

const WEB_PORT = 3000
const IS_DEV = !app.isPackaged

function getProjectPathFromArgs(argv: string[]): string | null {
  // argv: ['electron', 'main.js', '/optional/project/path']
  const path = argv.find((arg, i) => i >= 2 && !arg.startsWith('--') && arg.startsWith('/'))
  return path ?? null
}

function buildUrl(projectPath: string | null): string {
  const base = IS_DEV ? `http://localhost:5173` : `http://localhost:${WEB_PORT}`
  if (projectPath) {
    return `${base}/new?projectPath=${encodeURIComponent(projectPath)}`
  }
  return base
}

let mainWindow: BrowserWindow | null = null

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  mainWindow.loadURL(url)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function main() {
  const projectPath = getProjectPathFromArgs(process.argv)

  // Single-instance lock
  const gotLock = app.requestSingleInstanceLock({ projectPath })
  if (!gotLock) {
    app.quit()
    return
  }

  app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
    const data = additionalData as { projectPath: string | null }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.loadURL(buildUrl(data.projectPath))
    }
  })

  await app.whenReady()

  // Initialize provider and start servers before opening the window
  await initializeProvider()

  if (!IS_DEV) {
    const webDistPath = getWebDistPath(app)
    await startServers(webDistPath)
  } else {
    // In dev, only start the agent server; web is served by Vite
    const { startAgentServer } = await import('@zaga/agent/server')
    await startAgentServer(2024)
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/desktop
pnpm exec tsc --noEmit
```

Fix any errors before continuing.

- [ ] **Step 3: Run the desktop app in development**

First ensure the Vite dev server is running:

```bash
# Terminal 1
cd apps/web && pnpm dev
```

Then start the Electron app:

```bash
# Terminal 2
cd apps/desktop
pnpm exec electron --import tsx/esm src/main.ts
```

Expected: Electron window opens, loads the web app from `localhost:5173`, agent server starts on `:2024`.

- [ ] **Step 4: Test single-instance with project path**

While the Electron app is running, open a new terminal:

```bash
cd apps/desktop
pnpm exec electron --import tsx/esm src/main.ts /tmp/test-project
```

Expected: the existing window navigates to `/new?projectPath=%2Ftmp%2Ftest-project` rather than opening a new window.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): implement Electron main process with single-instance lock"
```

---

## Task 16: Create zaga CLI launcher + wire up root scripts

**Files:**

- Create: `apps/desktop/bin/zaga`
- Modify: `package.json` (root)

- [ ] **Step 1: Create `apps/desktop/bin/zaga`**

```bash
mkdir -p apps/desktop/bin
```

Create `apps/desktop/bin/zaga` (no extension — it's a shell script):

```sh
#!/usr/bin/env sh
# Launches Zaga Code desktop app with an optional project path.
# Usage: zaga [/path/to/project]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

exec npx electron --import tsx/esm "$DESKTOP_DIR/src/main.ts" "$@"
```

Make it executable:

```bash
chmod +x apps/desktop/bin/zaga
```

- [ ] **Step 2: Add to root `package.json` scripts**

Add the following scripts:

```json
"desktop:dev": "pnpm --filter @zaga/desktop dev",
"desktop:build": "pnpm --filter web build && pnpm --filter @zaga/desktop build"
```

- [ ] **Step 3: Test the CLI script**

```bash
# With app already running:
apps/desktop/bin/zaga /tmp/some-project

# Fresh launch:
apps/desktop/bin/zaga
```

Expected in first case: existing window focuses and navigates to `/new?projectPath=/tmp/some-project`.
Expected in second case: new Electron window opens.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/bin/zaga package.json
git commit -m "feat(desktop): add zaga CLI launcher"
```

---

## Self-Review Checklist

After writing this plan, verified against the spec:

- [x] CLI invocation (`zaga /path`) — Task 15 (single-instance), Task 16 (CLI script)
- [x] No manual startup — Task 15 (provider init + server start in `main()`)
- [x] Web UI on LAN — Task 14 (`sirv` server on `:3000`)
- [x] No LangGraph SDK in web — Tasks 7–12 (tRPC replaces all SDK usage)
- [x] Typed contract (tRPC `AppRouter`) — Tasks 3–6 + Task 8
- [x] SQLite checkpointer at `~/.zaga/history.db` — Tasks 1–2
- [x] Provider config (skip lms if apiKey present) — Task 2
- [x] `projectPath` from URL query param — Task 12
- [x] Electron single-instance lock — Task 15
- [x] `StreamEvent` discriminated union — Tasks 5 + 9
- [x] `useAgentStream` hook with reducer — Tasks 9–10
