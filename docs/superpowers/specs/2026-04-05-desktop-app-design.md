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

A monorepo with three apps and one shared package:

```
apps/agent      — LangGraph graph + tools + Hono RPC HTTP server
apps/web        — React SPA (TanStack Router, Vite, no SSR)
apps/desktop    — Electron shell
packages/types  — Shared StreamEvent types (server + client)
```

At runtime, a single Electron process does everything:

```
Electron main process
│
├── :2024  Agent API (Hono RPC)
│   ├── POST /threads
│   ├── POST /threads/:id/runs/stream   (SSE)
│   ├── DELETE /threads/:id/runs/current
│   ├── GET  /threads
│   └── GET  /threads/:id
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

## Package: `packages/types`

A minimal shared package imported by both `apps/agent` and `apps/web`. Contains the SSE event discriminated union and request/response types for all API endpoints.

```ts
export type StreamEvent =
  | { type: 'message_chunk'; content: string; role: 'assistant' }
  | { type: 'tool_start'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_end'; toolCallId: string; output: unknown }
  | { type: 'values'; usedTokens: number; maxTokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

TypeScript enforces the contract. Any server-side event shape change breaks the web client at compile time.

## Package: `apps/agent`

### Changes from current `main`

- Add a Hono RPC HTTP server (`src/server.ts`) as an adapter over the existing graph. The graph itself is unchanged.
- Add SQLite checkpointer (`@langchain/langgraph-checkpoint-sqlite`) at `~/.zaga/history.db`. Thread IDs are UUIDs, created at `POST /threads`.
- Remove dependency on `langgraph-cli` and the LangGraph dev server entirely.
- Add provider initialization at startup (see Provider Config section).

### Hono RPC endpoints

```
POST /threads
  body: { projectPath: string }
  returns: { threadId: string }

POST /threads/:id/runs/stream
  body: { input: string }
  returns: SSE stream of StreamEvent

DELETE /threads/:id/runs/current
  interrupts the running stream for this thread

GET /threads
  returns: { threads: { threadId, projectPath, createdAt, lastMessage }[] }

GET /threads/:id
  returns: { messages: Message[], usedTokens: number, maxTokens: number }
```

The Hono app type is exported and consumed by `apps/web` via Hono's `hc<AppType>()` typed client.

### Provider configuration

Read once at server startup from `~/.zaga/settings.json`:

```json
// LM Studio (default, no extra keys needed)
{}

// Any OpenAI-compatible provider
{
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "apiBase": "https://api.openai.com/v1"  // optional, defaults to OpenAI
}
```

If `apiKey` and `model` are present, skip all `lms` CLI checks and instantiate the model directly. If not, run the existing LM Studio setup flow from the refactor branch. This covers OpenAI, Groq, Together, and any other OpenAI-compatible provider without additional SDK work. Anthropic support (different client) is deferred to a future iteration.

## Package: `apps/web`

### SPA migration

- Remove `@tanstack/start` and SSR configuration.
- Replace with plain `@tanstack/react-router` + standard Vite SPA config.
- The build output is static files served by the Electron app (or any static host for web deployments).
- `VITE_LANGGRAPH_API_URL` renamed to `VITE_AGENT_API_URL`, defaults to `http://localhost:2024`.

### Drop LangGraph SDK

Remove `@langchain/langgraph-sdk` entirely. Replace `useStream` with a custom `useAgentStream` hook.

**`useAgentStream` hook:**

```ts
const stream = useAgentStream({ threadId })

stream.messages // Message[]
stream.toolProgress // Record<toolCallId, ToolCall>
stream.values // { usedTokens, maxTokens }
stream.isLoading // boolean
stream.submit(input) // send message, opens SSE connection
stream.stop() // interrupt current run
```

The hook opens an SSE connection to `POST /threads/:id/runs/stream`, reads typed `StreamEvent`s from `packages/types`, and feeds them through a reducer into the state above. On mount it checks `GET /threads/:id` — if a run is in progress it reconnects automatically, replacing `reconnectOnMount` behavior.

The typed Hono client (`hc<AppType>`) is the only place HTTP calls are made. No raw `fetch` elsewhere in the frontend.

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
3. Start agent HTTP server on `:2024`.
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
  → POST /threads { projectPath } → { threadId: "uuid" }
  → Navigate to /:threadId
  → POST /threads/uuid/runs/stream { input }
  → SSE stream → useAgentStream reducer → UI updates
  → On done: SQLite checkpoint saved
```

## Implementation notes

- The `refactor` branch contains working implementations of the SQLite checkpointer, the streaming state reducer, and the lms model setup flow. These should be ported/adapted rather than rebuilt from scratch.
- `packages/types` is a pnpm workspace package imported by both `apps/agent` and `apps/web`.
- In development, `apps/desktop` proxies `:3000` to the Vite dev server running on `:5173` so hot reload works normally.

## Out of scope (deferred)

- Anthropic/non-OpenAI-compatible provider support
- Native OS notifications / dock badges
- Auto-update mechanism
- Multi-window support (one project per window)
- Settings UI (provider config edited in `settings.json` for now)
