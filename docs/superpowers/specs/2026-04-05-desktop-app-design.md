# Desktop App Design

**Date:** 2026-04-05
**Status:** Approved

## Goals

1. CLI invocation: `zaga /path/to/project` opens the app with the project path prefilled in a new session. If the app is already running, focus the existing window and navigate there.
2. No manual startup: the agent, web UI, and model setup all happen as part of the app's startup sequence.
3. Web UI accessible from other devices on the LAN (e.g. mobile).
4. Decouple from the LangGraph SDK and LangGraph dev server — own the contract end-to-end.
5. Support providers beyond LM Studio via `~/.zaga/settings.json`.

## Architecture Overview

A monorepo with three apps:

```
apps/agent      — LangGraph graph + tools + tRPC server
apps/web        — React SPA (TanStack Router, Vite, no SSR)
apps/desktop    — Electron shell
```

At runtime, a single Electron process does everything:

```
Electron main process
│
├── :2024  Agent API (tRPC over HTTP)
│   ├── threads.create
│   ├── threads.list
│   ├── threads.get
│   ├── runs.stream     (tRPC subscription → SSE)
│   └── runs.cancel
│
├── :3000  Web UI
│   └── Static Vite build (or Vite dev server in development)
│
└── BrowserWindow → http://localhost:3000

~/.zaga/
├── history.db       (SQLite checkpointer)
└── settings.json    (provider config + MCP definitions)
```

The web UI is identical whether opened in the Electron webview or a browser on the LAN. No Electron-specific APIs appear in component code.

## Package: `apps/agent`

### Changes from current `main`

- Add a tRPC router (`src/router.ts`) as an adapter over the existing graph. The graph itself is unchanged.
- Add SQLite checkpointer (`@langchain/langgraph-checkpoint-sqlite`) at `~/.zaga/history.db`. Thread IDs are UUIDs created at `threads.create`.
- Remove dependency on `langgraph-cli` and the LangGraph dev server entirely.
- Add provider initialization at startup (see Provider Config section).
- Export `AppRouter` type — this is the shared contract, imported directly by `apps/web`. No separate types package needed.

### tRPC router

```ts
export const appRouter = router({
  threads: router({
    create: procedure
      .input(z.object({ projectPath: z.string() }))
      .mutation(/* → { threadId: string } */),

    list: procedure.query(/* → { threads: Thread[] } */),

    get: procedure
      .input(z.object({ threadId: z.string() }))
      .query(/* → { messages: Message[], usedTokens: number, maxTokens: number } */),
  }),

  runs: router({
    stream: procedure
      .input(z.object({ threadId: z.string(), input: z.string() }))
      .subscription(/* → AsyncIterable<StreamEvent> via SSE */),

    cancel: procedure
      .input(z.object({ threadId: z.string() }))
      .mutation(/* interrupts running stream */),
  }),
})

export type AppRouter = typeof appRouter
```

Stream events emitted by the subscription:

```ts
type StreamEvent =
  | { type: 'message_chunk'; content: string; role: 'assistant' }
  | { type: 'tool_start'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_end'; toolCallId: string; output: unknown }
  | { type: 'values'; usedTokens: number; maxTokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

TypeScript enforces the contract. Any server-side event shape change breaks the web client at compile time.

### Provider configuration

Read once at server startup from `~/.zaga/settings.json`:

```json
// LM Studio (default, no extra keys needed)
{}

// Any OpenAI-compatible provider
{
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "apiBase": "https://api.openai.com/v1"
}
```

If `apiKey` and `model` are present, skip all `lms` CLI checks and instantiate the model directly. If not, run the existing LM Studio setup flow from the refactor branch. This covers OpenAI, Groq, Together, and any other OpenAI-compatible provider. Anthropic support (different client) is deferred.

## Package: `apps/web`

### SPA migration

- Remove `@tanstack/start` and SSR configuration.
- Replace with plain `@tanstack/react-router` + standard Vite SPA config.
- The build output is static files served by the Electron app (or any static host for web deployments).
- `VITE_LANGGRAPH_API_URL` renamed to `VITE_AGENT_API_URL`, defaults to `http://localhost:2024`.

### Drop LangGraph SDK

Remove `@langchain/langgraph-sdk` entirely. Replace with `@trpc/react-query` pointing at our tRPC server.

```ts
import type { AppRouter } from '@zaga/agent'

const trpc = createTRPCReact<AppRouter>()
```

Streaming is handled via tRPC's `useSubscription`:

```ts
trpc.runs.stream.useSubscription(
  { threadId, input },
  {
    onData(event) {
      /* update local state via reducer */
    },
    onError(err) {
      /* handle error */
    },
  }
)
```

Local state shape (mirrors the existing UI surface):

```ts
stream.messages // Message[]
stream.toolProgress // Record<toolCallId, ToolCall>
stream.values // { usedTokens, maxTokens }
stream.isLoading // boolean
```

### `platform.ts`

The only Electron-aware module in `apps/web`. Abstracts the two ways a project path can arrive:

```ts
// In Electron: listens for ipcRenderer 'open-project' message
// In browser: reads ?projectPath= from URL query param
export function onOpenProject(cb: (path: string) => void): void
```

No component touches `window.electronAPI` or any Electron API directly.

## Package: `apps/desktop`

### Startup sequence

1. Acquire single-instance lock (see CLI section).
2. Read `~/.zaga/settings.json` and run provider/model setup.
3. Start agent tRPC server on `:2024`.
4. Start web UI server on `:3000` (static files in prod, proxy to Vite on `:5173` in dev).
5. Open `BrowserWindow` pointing to `http://localhost:3000[?projectPath=...]`.

### File structure

```
apps/desktop/
├── src/
│   ├── main.ts       — entry point, startup sequence, IPC handlers
│   ├── servers.ts    — starts :2024 and :3000
│   └── setup.ts      — provider/model initialization
└── package.json
```

### CLI invocation

A small `zaga` launcher script (installed globally via electron-builder or `npm link`) passes the project path to the Electron process:

```sh
zaga /path/to/project
```

Electron's single-instance lock handles both cases:

```ts
const gotLock = app.requestSingleInstanceLock({ projectPath })

if (!gotLock) {
  app.quit() // existing instance will handle it
} else {
  app.on('second-instance', (_, __, ___, { projectPath }) => {
    win.focus()
    win.webContents.send('open-project', projectPath)
  })
}
```

- **App already running:** `second-instance` fires → main process sends `open-project` IPC to renderer → `platform.ts` calls the registered callback → React navigates to `/new?projectPath=...`.
- **Cold start with path:** after window is ready, navigate to `/new?projectPath=...` from the launch args.
- **Cold start without path:** open normally to the session list / home screen.

## Data flow: new session

```
User runs: zaga /projects/foo
  → Electron opens /new?projectPath=/projects/foo
  → User enters prompt, submits
  → trpc.threads.create({ projectPath }) → { threadId: "uuid" }
  → Navigate to /:threadId
  → trpc.runs.stream.useSubscription({ threadId, input })
  → StreamEvents → local reducer → UI updates
  → On done: SQLite checkpoint saved
```

## Implementation notes

- The `refactor` branch contains working implementations of the SQLite checkpointer, the streaming state reducer, and the lms model setup flow. These should be ported/adapted rather than rebuilt from scratch.
- In development, `apps/desktop` proxies `:3000` to the Vite dev server running on `:5173` so hot reload works normally.
- tRPC v11 is required for SSE subscription support.

## Out of scope (deferred)

- Anthropic/non-OpenAI-compatible provider support
- Native OS notifications / dock badges
- Auto-update mechanism
- Multi-window support (one project per window)
- Settings UI (provider config edited in `settings.json` for now)
