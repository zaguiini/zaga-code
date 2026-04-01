# 05 — Terminal Refactor

## What Goes Away

- `apps/web/` — the entire React frontend
- The LangGraph API server (`langgraph.json`, LangGraph SDK server)
- SSE streaming layer
- Thread management via LangGraph API
- Title generator node (irrelevant in a terminal)

## What Stays

- `apps/api/src/graphs/` — the LangGraph graph, just run in-process (renamed to `apps/agent/` in this doc)
- `apps/api/src/nodes/` — all nodes (title-generator already removed in doc 04)
- `apps/api/src/tools/` — all tools
- `apps/api/src/utils/` — langfuse, validate-path, token-budget, summarize, etc.

## Target

```bash
cd ~/my-project
zaga "refactor the auth module to use JWT"
# or interactively:
zaga
> refactor the auth module to use JWT
```

The CLI runs the graph in-process, streams output to the terminal, and exits when done.

---

## Technology Choice: Ink

Use **Ink** (React for CLIs). The project already uses React on the web side, so the component model is familiar. Ink gives us declarative rendering, composable components, and a rich ecosystem for input, spinners, and layout.

---

## UI Zones

The terminal is divided into four vertical zones:

```
┌─────────────────────────────────┐
│  <MessageHistory />             │  Static: completed turns (never re-rendered)
│  user: refactor auth to JWT     │
│  assistant: I'll start by...    │
│  [shell] git status → ...       │
├─────────────────────────────────┤
│  <ActiveResponse />             │  Live: currently streaming text + tool calls
│  ⠋ Thinking...                  │
│  I'll refactor the auth module  │
│  [file-read] src/auth.ts → ... │
├─────────────────────────────────┤
│  <StatusBar />                  │  project path, token usage
│  ~/my-project  ·  1.2k tokens  │
├─────────────────────────────────┤
│  <InputPrompt />                │  text input or confirmation prompt
│  > _                            │
└─────────────────────────────────┘
```

- **`<MessageHistory />`** — Ink's `<Static>` component. Completed turns are appended here and never re-rendered.
- **`<ActiveResponse />`** — Re-renders on every stream event. Shows a spinner while waiting for the first token, then streaming text and tool call badges.
- **`<StatusBar />`** — Single line. Project path left-aligned, token count right-aligned. Bordered on top.
- **`<InputPrompt />`** — `ink-text-input` when idle. Switches to a `[y/N]` confirmation prompt when the agent flags a destructive command.

---

## State & Data Flow

A single `useAgent` hook manages the connection between the LangGraph stream and React state. No external state library.

### Flow

```
User types input
  → useAgent.send(text)
    → agent.streamEvents(...)
      → events arrive one by one
        → dispatch to reducer
          → React re-renders ActiveResponse
      → stream ends
        → move completed response into history array
          → Static renders it, ActiveResponse clears
```

### State Shape

```typescript
type ToolCall = {
  name: string
  input: string
  output?: string
  status: 'running' | 'done'
}

type CompletedTurn = {
  userMessage: string
  assistantText: string
  tools: ToolCall[]
}

type AppState = {
  status: 'idle' | 'streaming' | 'confirming'
  history: CompletedTurn[]
  activeResponse: {
    text: string
    tools: ToolCall[]
  } | null
  tokenCount: number
  confirm: {
    command: string
    resolve: (approved: boolean) => void
  } | null
}
```

### Reducer Events

| Graph event            | State update                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `on_chat_model_stream` | Append text chunk to `activeResponse.text`                         |
| `on_tool_start`        | Push new entry to `activeResponse.tools[]` with status `'running'` |
| `on_tool_end`          | Update that tool entry with output and status `'done'`             |
| Stream ends            | Move `activeResponse` into `history[]`, reset active state         |

---

## Confirmation Hook

The shell tool's `checkShellSafety` result drives a React state change instead of blocking on raw readline.

A `confirmFn` is injected into the graph's configurable context:

```typescript
const confirmFn = (command: string): Promise<boolean> => {
  return new Promise(resolve => {
    dispatch({ type: 'confirm', command, resolve })
  })
}
```

When `status` is `'confirming'`, `<InputPrompt />` renders:

```
⚠ Destructive command: rm -rf dist/
Run it? [y/N] _
```

The user presses `y` or `n`, the promise resolves, the shell tool continues or skips, and the UI returns to streaming.

---

## Interrupt Handling

Handled via Ink's `useInput` hook inside the root `<App>` component. No separate interrupt module.

- **During streaming:** Abort the graph stream via `AbortController.signal`. The `useAgent` hook catches `AbortError`, prints `[interrupted]`, returns to idle.
- **During idle:** Exit the process.
- **During confirmation:** Cancel the confirmation (resolve `false`), return to streaming.

The `AbortController.signal` is passed into `agent.streamEvents()`:

```typescript
agent.streamEvents(input, { ...config, signal: controller.signal })
```

---

## Rendering Details

### Streaming Text

Accumulated text gets basic ANSI styling via `chalk` — `` `code` ``, `**bold**`, and fenced code blocks. No full markdown parser; a few regex replacements are sufficient.

### Tool Calls

Rendered inline in `<ActiveResponse />`:

```
  ⠋ shell git status                     (running — spinner)
  ● file-read src/auth.ts               (done — colored dot)
  → export function authenticate(...    (truncated output)
```

- Running tools: spinner via `ink-spinner`
- Completed tools: colored dot + one-line truncated output
- Tool names are color-coded (shell = yellow, file tools = cyan)

### Spinner

Shows between user input and first streamed token: `⠋ Thinking...` via `ink-spinner`. Disappears on first `on_chat_model_stream` event.

### Status Bar

`<Box>` with top border, `flexDirection="row"`, `justifyContent="space-between"`. Token count updates after each completed turn.

---

## New App Structure

```
apps/cli/
  src/
    index.tsx              entry point, arg parsing, render(<App />)
    app.tsx                root <App>, orchestrates the four zones
    hooks/
      use-agent.ts         graph stream → React state, reducer, send()
      use-input-handler.ts Ctrl+C / Ctrl+D / submit handling
    components/
      message-history.tsx  <Static> completed turns
      active-response.tsx  live streaming text + tool calls
      tool-call.tsx        single tool call badge (spinner or done)
      status-bar.tsx       project path + token count
      input-prompt.tsx     text input or confirmation prompt
    session.ts             thread ID persistence (.zaga/session file)
  package.json
  tsconfig.json
```

Delete `apps/web/`. Rename `apps/api/` → `apps/agent/`.

---

## Entry Point

Before wiring the entry point, convert `apps/agent/src/setup.ts` from a self-executing script to an exportable function. Remove the `setup()` call at the bottom and `export` the function instead.

```typescript
// apps/cli/src/index.tsx
import { setup } from '@zaga/agent/setup'
import { createAgent } from '@zaga/agent/graphs/agent'
import { createSession } from './session'
import { render } from 'ink'
import { App } from './app'

async function main() {
  await setup()
  const projectPath = process.cwd()
  const agent = await createAgent()
  const session = await createSession(projectPath)
  const prompt = process.argv.slice(2).join(' ')

  render(<App agent={agent} session={session} projectPath={projectPath} initialPrompt={prompt || undefined} />)
}

main().catch(console.error)
```

Single-shot mode: `<App initialPrompt="refactor auth" />` streams the response, then the Ink app unmounts when done via `useApp().exit()`.

REPL mode: default when no args — stays alive, accepts input. `/exit` and Ctrl+D unmount the app.

---

## Session Persistence

`.zaga/session` stores the thread ID. `.zaga/history.db` stores conversation history via LangGraph's SQLite checkpointer.

```typescript
// apps/cli/src/session.ts
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Session = {
  threadId: string
  setThreadId: (id: string) => Promise<void>
}

export async function createSession(projectPath: string): Promise<Session> {
  const sessionFile = join(projectPath, '.zaga', 'session')
  await mkdir(join(projectPath, '.zaga'), { recursive: true })

  let threadId: string
  try {
    threadId = (await readFile(sessionFile, 'utf-8')).trim()
  } catch {
    threadId = crypto.randomUUID()
    await writeFile(sessionFile, threadId, 'utf-8')
  }

  return {
    get threadId() {
      return threadId
    },
    async setThreadId(id: string) {
      threadId = id
      await writeFile(sessionFile, id, 'utf-8')
    },
  }
}
```

For message history persistence across restarts:

```typescript
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

const checkpointer = new SqliteSaver(join(projectPath, '.zaga', 'history.db'))
const agent = (await createAgent()).compile({ checkpointer })
```

---

## package.json for CLI

```json
{
  "name": "@zaga/cli",
  "bin": { "zaga": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.tsx"
  },
  "dependencies": {
    "@zaga/agent": "workspace:*",
    "@langchain/langgraph-checkpoint-sqlite": "^1.0.0",
    "ink": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^6.0.0",
    "react": "^19.0.0",
    "chalk": "^5.0.0"
  }
}
```

Add to `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/agent
  - apps/cli
```
