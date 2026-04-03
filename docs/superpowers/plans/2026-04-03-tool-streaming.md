# Tool Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream tool execution output in real-time — shell stdout/stderr as it runs, explore subagent's full inner activity (text + tool calls) as nested collapsible blocks.

**Architecture:** Tools return async generators that yield streaming chunks via LangGraph's `tools` stream mode. Each `yield` dispatches an `on_tool_event` picked up by the frontend's `toolProgress`. The frontend renders streaming data inline in tool call blocks. `toolProgress.data` is replaced (not accumulated) on each event, so yields contain the full current state.

**Tech Stack:** LangGraph `tools` stream mode, `AsyncGenerator` in tool functions, `useStream.toolProgress` on the frontend, existing `CollapsibleBlock` UI component.

---

## File Structure

| File                                          | Responsibility                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/agent/src/tools/shell.ts`               | Modify: `exec` → `spawn`, return async generator yielding stdout/stderr                                   |
| `apps/agent/src/tools/explore.ts`             | Modify: `.invoke()` → `.stream()`, return async generator yielding subagent activity                      |
| `apps/web/src/routes/_layout.$threadId.tsx`   | Modify: add `'tools'` stream mode, wire `toolProgress` into tool invocation rendering, remove phase logic |
| `apps/web/src/components/ui/chat-message.tsx` | Modify: add `streaming` state to `ToolCallBlock`, remove `PhaseGroup`/`PhaseBlock`                        |
| `apps/web/src/components/ui/message-list.tsx` | Modify: remove `PhaseGroup` type/rendering                                                                |

---

### Task 1: Shell tool — async generator with `spawn`

**Files:**

- Modify: `apps/agent/src/tools/shell.ts`

- [ ] **Step 1: Rewrite shell tool to use `spawn` and return async generator**

Replace the entire tool implementation. Key changes: `exec` → `spawn`, wrap in async generator, yield accumulated output on each chunk, return final output.

```ts
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { checkShellSafety } from '@/utils/shell-safety'

const shellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  confirmed: z
    .boolean()
    .optional()
    .describe('Set to true to confirm execution of a destructive command'),
})

const contextSchema = z.object({
  project_path: z.string(),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const shellTool = tool(
  async function* (
    input: z.infer<typeof shellSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) {
    if (input.command.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
      return `Command blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
    }

    const safety = checkShellSafety(input.command)

    if (safety === 'block') {
      return `Blocked: "${input.command}" matches a permanently blocked pattern.`
    }

    if (safety === 'confirm' && !input.confirmed) {
      return `CONFIRMATION_REQUIRED: "${input.command}" is a destructive command. Re-run with confirmed: true to execute.`
    }

    const resolvedProjectPath = resolve(project_path)

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
      (promiseResolve, reject) => {
        const child = spawn('sh', ['-c', input.command], {
          cwd: resolvedProjectPath,
          env: process.env,
        })

        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString()
          // We can't yield from inside a callback, so we collect and yield from the outer loop
        })

        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        child.on('error', reject)
        child.on('close', exitCode => {
          promiseResolve({ stdout, stderr, exitCode: exitCode ?? 0 })
        })
      }
    )

    // Format output identically to the original tool
    let output = ''
    if (result.stdout) {
      output += `STDOUT:\n${result.stdout}`
    }
    if (result.stderr) {
      output += output ? `\n\nSTDERR:\n${result.stderr}` : `STDERR:\n${result.stderr}`
    }

    if (result.exitCode !== 0) {
      return `Command failed (exit code ${result.exitCode})${output ? `\n\n${output}` : ''}`
    }

    return output || 'Command executed successfully (no output)'
  },
  {
    name: 'shell',
    description:
      'Execute a shell command in the project directory. Captures both stdout and stderr. Commands referencing node_modules are blocked. Destructive commands require confirmation via the confirmed parameter.',
    schema: shellSchema,
  }
)
```

Wait — the challenge is that `yield` can't be called from inside a callback. We need to bridge the event-based `spawn` API with the async generator. Use an async iterator pattern with a queue:

```ts
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { checkShellSafety } from '@/utils/shell-safety'

const shellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  confirmed: z
    .boolean()
    .optional()
    .describe('Set to true to confirm execution of a destructive command'),
})

const contextSchema = z.object({
  project_path: z.string(),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const shellTool = tool(
  async function* (
    input: z.infer<typeof shellSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) {
    if (input.command.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
      return `Command blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
    }

    const safety = checkShellSafety(input.command)

    if (safety === 'block') {
      return `Blocked: "${input.command}" matches a permanently blocked pattern.`
    }

    if (safety === 'confirm' && !input.confirmed) {
      return `CONFIRMATION_REQUIRED: "${input.command}" is a destructive command. Re-run with confirmed: true to execute.`
    }

    const resolvedProjectPath = resolve(project_path)
    const child = spawn('sh', ['-c', input.command], {
      cwd: resolvedProjectPath,
      env: process.env,
    })

    // Bridge spawn events → async iteration via a simple queue
    type QueueItem =
      | { type: 'data'; text: string }
      | { type: 'done'; exitCode: number }
      | { type: 'error'; error: Error }
    const queue: QueueItem[] = []
    let resolve_: (() => void) | null = null

    function push(item: QueueItem) {
      queue.push(item)
      resolve_?.()
    }

    function waitForItem(): Promise<void> {
      if (queue.length > 0) return Promise.resolve()
      return new Promise(r => {
        resolve_ = r
      })
    }

    child.stdout.on('data', (data: Buffer) => push({ type: 'data', text: data.toString() }))
    child.stderr.on('data', (data: Buffer) => push({ type: 'data', text: data.toString() }))
    child.on('error', (error: Error) => push({ type: 'error', error }))
    child.on('close', (exitCode: number | null) => push({ type: 'done', exitCode: exitCode ?? 0 }))

    let accumulated = ''

    while (true) {
      await waitForItem()

      // Drain all queued items
      while (queue.length > 0) {
        const item = queue.shift()!

        if (item.type === 'error') {
          return `Command failed: ${item.error.message}`
        }

        if (item.type === 'done') {
          // Format final output
          const output = accumulated || 'Command executed successfully (no output)'
          if (item.exitCode !== 0) {
            return `Command failed (exit code ${item.exitCode})${accumulated ? `\n\n${accumulated}` : ''}`
          }
          return output
        }

        // type === 'data'
        accumulated += item.text
        yield accumulated
      }
    }
  },
  {
    name: 'shell',
    description:
      'Execute a shell command in the project directory. Captures both stdout and stderr. Commands referencing node_modules are blocked. Destructive commands require confirmation via the confirmed parameter.',
    schema: shellSchema,
  }
)
```

- [ ] **Step 2: Verify the agent still compiles**

Run: `cd apps/agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/tools/shell.ts
git commit -m "feat(shell): stream stdout/stderr via async generator"
```

---

### Task 2: Explore tool — stream subagent activity

**Files:**

- Modify: `apps/agent/src/tools/explore.ts`

- [ ] **Step 1: Rewrite explore tool to stream subagent activity**

Replace the entire tool. Key changes: `.invoke()` → `.stream()` with `streamMode: 'messages'`, yield structured events for AI text and tool calls/results, return final AI message content.

The `messages` stream mode emits `[messageChunk, metadata]` tuples. AI message chunks contain text deltas. Tool message chunks contain tool results.

```ts
import { createAgent, tool } from 'langchain'
import { z } from 'zod'
import { HumanMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { grepTool } from '@/tools/grep'

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration and planning specialist. Your job is to understand the codebase and produce an implementation plan — not to implement anything.

READ-ONLY MODE: You only have access to file search, file read, and grep tools. Do not attempt to create, edit, or delete files.

Rules:
- Prefer grep and file_search over guessing file paths. If file_read fails, the file doesn't exist — don't try variations.
- Search broadly first, then read specific files.
- Stop exploring once you have enough context to produce a plan. Perfection is not the goal.

When you have gathered enough information, write:

1. A brief summary of findings (relevant files, patterns, constraints)
2. A numbered implementation plan:
   - Be specific about file paths and what changes
   - Keep it under 10 steps
   - No code, just the plan`

const exploreSchema = z.object({
  prompt: z
    .string()
    .describe(
      'What to explore and why — be specific about what you need to understand or find in the codebase'
    ),
})

interface ExploreStreamEvent {
  type: 'text' | 'tool-call' | 'tool-result'
  content?: string
  name?: string
  args?: unknown
  result?: string
}

export function createExploreTool(model: BaseChatModel) {
  const exploreAgent = createAgent({
    model,
    tools: [fileSearchTool, fileReadTool, grepTool],
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    name: 'explore',
  })

  return tool(
    async function* ({ prompt }, config) {
      const stream = await exploreAgent.stream(
        { messages: [new HumanMessage(prompt)] },
        { ...config, streamMode: 'messages' }
      )

      const events: ExploreStreamEvent[] = []
      let lastAiText = ''

      for await (const [chunk, metadata] of stream) {
        // AI message chunks (text from the subagent LLM)
        if (chunk.type === 'ai') {
          const textContent =
            typeof chunk.content === 'string'
              ? chunk.content
              : Array.isArray(chunk.content)
                ? chunk.content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('')
                : ''

          if (textContent) {
            lastAiText += textContent
            events.push({ type: 'text', content: textContent })
            yield [...events]
          }

          // Tool calls from the AI (the subagent deciding to call a tool)
          if (chunk.tool_calls?.length) {
            for (const tc of chunk.tool_calls) {
              events.push({ type: 'tool-call', name: tc.name, args: tc.args })
            }
            yield [...events]
          }
        }

        // Tool result messages
        if (chunk.type === 'tool') {
          const resultContent =
            typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content)

          events.push({
            type: 'tool-result',
            name: chunk.name,
            result: resultContent,
          })
          yield [...events]
        }
      }

      return lastAiText || 'Exploration complete — no findings.'
    },
    {
      name: 'explore',
      description:
        'Explore the codebase to understand its structure, find relevant files, and produce an implementation plan. Use this for broader codebase exploration and deep research when your task will clearly require reading multiple files across different locations. For simple, directed searches (a specific file, class, or function), use file_search or grep directly instead — they are faster.',
      schema: exploreSchema,
    }
  )
}
```

Note: the `messages` stream mode for a `ReactAgent` emits `[MessageChunk, metadata]` tuples. AI chunks have `type: 'ai'` and may have `content` (text) and `tool_calls`. Tool chunks have `type: 'tool'` with `name` and `content`.

Each `yield [...events]` sends the full accumulated event list as `toolProgress.data`, since the SDK replaces rather than appends.

- [ ] **Step 2: Verify the agent still compiles**

Run: `cd apps/agent && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/tools/explore.ts
git commit -m "feat(explore): stream subagent activity via async generator"
```

---

### Task 3: Frontend — add `tools` stream mode and wire up `toolProgress`

**Files:**

- Modify: `apps/web/src/routes/_layout.$threadId.tsx`

- [ ] **Step 1: Add `'tools'` to stream mode arrays**

In the `stream.submit()` call and `stream.joinStream()` call, add `'tools'` to the `streamMode` arrays:

Find both locations and change `['messages', 'values']` to `['messages', 'values', 'tools']`.

In `stream.submit()` (around line 264):

```ts
streamMode: ['messages', 'values', 'tools'],
```

In `stream.joinStream()` (around line 48):

```ts
streamMode: ['messages', 'values', 'tools'],
```

- [ ] **Step 2: Remove phase tracking logic from the `items` useMemo**

Remove all phase-related code from the `items` useMemo:

- Remove the `phaseGroups` Map declaration
- Remove the `activePhase` variable
- Remove the phase change detection block (`if (activePhase && phase !== activePhase ...`)
- Remove the `activePhase = phase` assignment
- Remove the `const phase = ...` line
- Remove the `if (phase) { ... }` block at the end — just push `displayMessages` directly into `result`

After cleanup, the end of the loop body becomes:

```ts
      if (displayMessages.length === 0) continue
      result.push(...displayMessages)
    }

    return result
  }, [stream.messages])
```

- [ ] **Step 3: Wire `toolProgress` into tool invocation parts**

In the `items` useMemo, where pending/completed tool calls are built into `ToolInvocationPart`, add a `streaming` state using `toolProgress`.

Add `stream.toolProgress` to the useMemo dependency array.

In the tool calls loop, replace the current pending/completed logic with:

```ts
for (const toolCall of messageToolCalls) {
  const parts: Array<ToolInvocationPart> = []

  // Find matching tool progress for this call
  const progress = stream.toolProgress.find(tp => tp.toolCallId === toolCall.call.id)

  if (toolCall.state === 'completed') {
    parts.push({
      type: 'tool-invocation',
      toolInvocation: {
        toolName: toolCall.call.name,
        state: 'result',
        args: toolCall.call.args,
        result: toolCall.result?.content.toString() ?? 'No result',
      },
    })
  } else if (progress?.state === 'running' && progress.data != null) {
    parts.push({
      type: 'tool-invocation',
      toolInvocation: {
        toolName: toolCall.call.name,
        state: 'streaming',
        args: toolCall.call.args,
        data: progress.data,
      },
    })
  } else {
    // pending (starting or no data yet)
    parts.push({
      type: 'tool-invocation',
      toolInvocation: {
        args: toolCall.call.args,
        toolName: toolCall.call.name,
        state: 'call',
      },
    })
  }

  displayMessages.push({
    id: toolCall.id,
    role: 'assistant',
    content: '',
    parts,
  })
}
```

- [ ] **Step 4: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: Will have errors until we update the types in chat-message.tsx (next task). That's fine — just verify the route file itself has no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_layout.$threadId.tsx
git commit -m "feat: add tools stream mode and wire toolProgress into rendering"
```

---

### Task 4: Frontend — update chat-message types and ToolCallBlock rendering

**Files:**

- Modify: `apps/web/src/components/ui/chat-message.tsx`

- [ ] **Step 1: Add `ToolStreaming` type and update `ToolInvocation` union**

Add the new type after the existing `ToolResult` interface:

```ts
interface ToolStreaming {
  state: 'streaming'
  toolName: string
  args: Record<string, any>
  data: unknown
}

type ToolInvocation = ToolCall | ToolResult | ToolStreaming
```

- [ ] **Step 2: Remove PhaseGroup, PhaseBlock, and PHASE_CONFIG**

Delete these items from the file:

- The `PHASE_CONFIG` constant (around line 287-293)
- The `PhaseBlock` export function (around line 295-313)
- The `PhaseGroup` export interface (around line 103-107)

- [ ] **Step 3: Add `streaming` case to `ToolCallBlock`**

Add a new case in the `ToolCallBlock` switch between `call` and `result`:

```ts
          case 'streaming': {
            // Shell tool: data is the accumulated stdout/stderr string
            if (typeof invocation.data === 'string') {
              return (
                <CollapsibleBlock
                  key={index}
                  icon={<Loader2 className="h-3 w-3 animate-spin" />}
                  title={
                    <span>
                      Running{' '}
                      <span className="font-mono text-xs">
                        {'`'}
                        {invocation.toolName}
                        {'`'}
                      </span>
                      ...
                    </span>
                  }
                  defaultOpen
                >
                  <pre className="font-mono whitespace-pre-wrap">{invocation.data}</pre>
                </CollapsibleBlock>
              )
            }

            // Explore tool: data is an array of ExploreStreamEvent objects
            if (Array.isArray(invocation.data)) {
              return (
                <CollapsibleBlock
                  key={index}
                  icon={<Loader2 className="h-3 w-3 animate-spin" />}
                  title={
                    <span>
                      Running{' '}
                      <span className="font-mono text-xs">
                        {'`'}
                        {invocation.toolName}
                        {'`'}
                      </span>
                      ...
                    </span>
                  }
                  defaultOpen
                >
                  <div className="space-y-2">
                    {invocation.data.map((event: any, i: number) => {
                      if (event.type === 'text') {
                        return (
                          <div key={i} className="whitespace-pre-wrap">
                            <MarkdownRenderer>{event.content}</MarkdownRenderer>
                          </div>
                        )
                      }
                      if (event.type === 'tool-call') {
                        return (
                          <CollapsibleBlock
                            key={i}
                            icon={<Code2 className="h-4 w-4" />}
                            title={
                              <span>
                                Calling{' '}
                                <span className="font-mono text-xs">
                                  {'`'}
                                  {event.name}
                                  {'`'}
                                </span>
                              </span>
                            }
                          >
                            Arguments: {JSON.stringify(event.args)}
                          </CollapsibleBlock>
                        )
                      }
                      if (event.type === 'tool-result') {
                        return (
                          <CollapsibleBlock
                            key={i}
                            icon={<Code2 className="h-4 w-4" />}
                            title={
                              <span>
                                Result from{' '}
                                <span className="font-mono text-xs">
                                  {'`'}
                                  {event.name}
                                  {'`'}
                                </span>
                              </span>
                            }
                          >
                            {event.result}
                          </CollapsibleBlock>
                        )
                      }
                      return null
                    })}
                  </div>
                </CollapsibleBlock>
              )
            }

            // Unknown data shape — fall back to call-style display
            return (
              <CollapsibleBlock
                key={index}
                icon={<Loader2 className="h-3 w-3 animate-spin" />}
                title={
                  <span>
                    Running{' '}
                    <span className="font-mono text-xs">
                      {'`'}
                      {invocation.toolName}
                      {'`'}
                    </span>
                    ...
                  </span>
                }
              >
                Arguments: {JSON.stringify(invocation.args)}
              </CollapsibleBlock>
            )
          }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/chat-message.tsx
git commit -m "feat: add streaming state to ToolCallBlock, remove PhaseGroup"
```

---

### Task 5: Update message-list to remove PhaseGroup

**Files:**

- Modify: `apps/web/src/components/ui/message-list.tsx`

- [ ] **Step 1: Remove PhaseGroup from message-list**

Update the file to remove all PhaseGroup references:

```ts
import type { ChatMessageProps, Message } from '@/components/ui/chat-message'
import { ChatMessage } from '@/components/ui/chat-message'
import { TypingIndicator } from '@/components/ui/typing-indicator'

export type MessageListItem = Message

type AdditionalMessageOptions = Omit<ChatMessageProps, keyof Message>

interface MessageListProps {
  messages: Array<MessageListItem>
  showTimeStamps?: boolean
  isTyping?: boolean
  messageOptions?: AdditionalMessageOptions | ((message: Message) => AdditionalMessageOptions)
}

export function MessageList({
  messages,
  showTimeStamps = true,
  isTyping = false,
  messageOptions,
}: MessageListProps) {
  return (
    <div className="space-y-4 overflow-visible">
      {messages.map((message, index) => {
        const additionalOptions =
          typeof messageOptions === 'function' ? messageOptions(message) : messageOptions

        return (
          <ChatMessage
            key={index}
            showTimeStamp={showTimeStamps}
            {...message}
            {...additionalOptions}
          />
        )
      })}
      {isTyping && <TypingIndicator />}
    </div>
  )
}
```

- [ ] **Step 2: Verify full frontend compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/message-list.tsx
git commit -m "refactor: remove PhaseGroup from message-list"
```

---

### Task 6: Manual integration test

- [ ] **Step 1: Start the agent dev server**

Run: `cd apps/agent && npm run dev`

- [ ] **Step 2: Start the web dev server**

Run: `cd apps/web && npm run dev`

- [ ] **Step 3: Test shell tool streaming**

Send a message that triggers a shell command with visible output, e.g. "Run `ls -la` in the project root". Verify:

- The tool block shows "Running `shell`..." with a spinner while the command runs
- stdout appears in the tool block as it streams
- After completion, the block transitions to "Result from `shell`"

- [ ] **Step 4: Test explore tool streaming**

Send a message that triggers exploration, e.g. "Explore the project structure and explain how the agent graph works". Verify:

- The tool block shows "Running `explore`..." with a spinner
- Inside the block, you see nested collapsible blocks for subagent tool calls (file_search, file_read, grep)
- Subagent text appears as it streams
- After completion, the block transitions to "Result from `explore`"
- Nested tool call blocks are collapsible

- [ ] **Step 5: Test reconnection**

While a long-running tool is executing, refresh the page and verify `joinStream` picks up the `tools` stream mode correctly.

- [ ] **Step 6: Commit any fixes**

If any issues were found and fixed during testing, commit them.
