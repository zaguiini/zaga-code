# Tool Streaming Design

## Goal

Stream tool execution output in real-time instead of showing results only after completion. Applies to all tools, with special handling for:

- **Shell tool**: stream stdout/stderr as the command runs
- **Explore tool**: stream the subagent's full inner activity (text + tool calls) as nested collapsible blocks

## Mechanism

LangGraph already supports tool streaming via the `tools` stream mode. When a tool's function returns an `AsyncGenerator`:

1. Each `yield` dispatches an `on_tool_event` via `CallbackManagerForToolRun.handleToolEvent()`
2. The generator's `return` value becomes the final tool result
3. The `StreamToolsHandler` relays events as `["tools", { event: "on_tool_event", toolCallId, name, data }]`
4. The `useStream` hook exposes these as `toolProgress: ToolProgress[]`

`ToolProgress` shape:

```ts
type ToolProgress = {
  toolCallId?: string
  name: string
  state: 'starting' | 'running' | 'completed' | 'error'
  input?: unknown
  data?: unknown // accumulated from on_tool_event chunks
  result?: unknown
  error?: unknown
}
```

## Backend Changes

### All tools: async generator pattern

Convert tool functions from `async (input, config) => string` to `async function* (input, config)` that yield streaming chunks and return the final result.

**Chunk format** — a consistent shape for all tools:

```ts
type ToolStreamChunk =
  | { type: 'text'; content: string } // text output (stdout, subagent text)
  | { type: 'tool-call'; name: string; args: unknown } // subagent calling a tool
  | { type: 'tool-result'; name: string; result: string } // subagent tool result
```

### Shell tool (`apps/agent/src/tools/shell.ts`)

- Replace `exec` (buffers) with `spawn` (streams)
- Yield `{ type: 'text', content: chunk }` for each stdout/stderr data event
- Tag chunks with source: `{ type: 'text', content: chunk, source: 'stdout' | 'stderr' }`
- Return the full combined output as the final result (same format as today)
- Handle process exit codes, errors, and the safety checks identically to today

### Explore tool (`apps/agent/src/tools/explore.ts`)

- Replace `exploreAgent.invoke()` with `exploreAgent.stream()` using `streamMode: 'messages'`
- Iterate over the stream and yield chunks:
  - AI message text chunks: `{ type: 'text', content: chunk }`
  - Tool calls from the subagent: `{ type: 'tool-call', name, args }`
  - Tool results from the subagent: `{ type: 'tool-result', name, result }`
- Return the final AI message content as the result (same as today)

### Other tools (file-read, file-write, file-edit, file-search, grep)

These are fast, synchronous-ish operations. No streaming needed — they continue returning strings directly. The `tools` stream mode already provides `on_tool_start` / `on_tool_end` for these, which is sufficient for showing a spinner → result transition.

## Frontend Changes

### Stream mode (`apps/web/src/routes/_layout.$threadId.tsx`)

Add `'tools'` to the `streamMode` arrays:

- In `stream.submit()` options: `streamMode: ['messages', 'values', 'tools']`
- In `stream.joinStream()` options: `streamMode: ['messages', 'values', 'tools']`

### Tool progress data flow

`useStream` already computes `toolProgress` from tool stream events. Each entry tracks a tool call's lifecycle and accumulates `data` from `on_tool_event` chunks.

Pass `stream.toolProgress` into the message list rendering pipeline. In the `items` useMemo, when building `ToolInvocationPart` for pending tool calls, attach the matching `toolProgress` entry so the UI can render streaming content.

Add a new tool invocation state to represent an actively streaming tool:

```ts
interface ToolStreaming {
  state: 'streaming'
  toolName: string
  args: Record<string, any>
  data: ToolStreamChunk[] // accumulated chunks from toolProgress.data
}
```

The state machine becomes: `call` → `streaming` (once first `on_tool_event` arrives) → `result`.

### Tool call block rendering (`apps/web/src/components/ui/chat-message.tsx`)

Add a `streaming` case to `ToolCallBlock`:

- **Header**: spinner icon + "Running `{toolName}`..."
- **Body** (collapsible, default open while streaming):
  - For shell: render accumulated text chunks as a terminal-style output block (monospace, dark background)
  - For explore: render chunks as nested content:
    - `text` chunks: rendered as markdown text
    - `tool-call` chunks: collapsible block showing "Calling `{name}`..." with args
    - `tool-result` chunks: collapsible block showing "Result from `{name}`" with result

This preserves the existing UX pattern where tool calls within the explore subagent are collapsible blocks, just nested inside the parent explore tool block.

### Remove PhaseGroup/PhaseBlock

The `PhaseGroup` and `PhaseBlock` components were the previous way to show explore subagent activity. With tool streaming, the explore tool's inner activity streams directly into its tool block. Remove:

- `PhaseGroup` type and `PhaseBlock` component from `chat-message.tsx`
- Phase tracking logic from the `items` useMemo in the thread route
- `PHASE_CONFIG` constant

## Summary of files to change

| File                                          | Change                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/agent/src/tools/shell.ts`               | `exec` → `spawn`, return async generator                                   |
| `apps/agent/src/tools/explore.ts`             | `.invoke()` → `.stream()`, return async generator                          |
| `apps/web/src/routes/_layout.$threadId.tsx`   | Add `'tools'` stream mode, pass `toolProgress`, remove phase logic         |
| `apps/web/src/components/ui/chat-message.tsx` | Add `streaming` state to `ToolCallBlock`, remove `PhaseGroup`/`PhaseBlock` |
| `apps/web/src/components/ui/message-list.tsx` | Remove `PhaseGroup` rendering (if referenced)                              |
