# Collapsible Subgraph Phase Blocks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collapsible UI blocks for explore, plan, and verify phases so users can see subgraph progress.

**Architecture:** Backend wrapper nodes forward LangGraph `config` to subgraph `.invoke()` calls and emit `phase_start`/`phase_end` custom events. Frontend tracks phase boundaries via `onCustomEvent`, groups messages by index range into `PhaseGroup` objects, and renders them as collapsible blocks using the existing `CollapsibleBlock` pattern.

**Tech Stack:** LangGraph (custom events, config forwarding), React, Radix UI Collapsible, Framer Motion, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-04-02-collapsible-subgraph-phases-design.md`

---

### Task 1: Backend — Update explore node to forward config and emit phase events

**Files:**

- Modify: `apps/agent/src/nodes/explore.ts`

- [ ] **Step 1: Update the explore node to accept config, forward it, and emit events**

Replace the entire contents of `apps/agent/src/nodes/explore.ts` with:

```typescript
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { Runnable } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

export function createExploreNode(exploreGraph: Runnable) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    await dispatchCustomEvent('phase_start', { phase: 'explore' }, config)

    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) {
      await dispatchCustomEvent('phase_end', { phase: 'explore' }, config)
      return {}
    }

    const result = await exploreGraph.invoke({ messages: [lastUserMessage] }, config)

    const lastMessage = [...result.messages]
      .reverse()
      .find((m: { type: string }) => m.type === 'ai')
    const summary = lastMessage ? String(lastMessage.content) : ''

    await dispatchCustomEvent('phase_end', { phase: 'explore' }, config)
    return { exploreSummary: summary }
  }
}
```

- [ ] **Step 2: Verify the agent app has no type errors**

Run: `cd apps/agent && npx tsc --noEmit`
Expected: No errors (or only pre-existing ones unrelated to this change).

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/nodes/explore.ts
git commit -m "feat: forward config and emit phase events in explore node"
```

---

### Task 2: Backend — Update verify node to forward config and emit phase events

**Files:**

- Modify: `apps/agent/src/nodes/verify.ts`

- [ ] **Step 1: Update the verify node to accept config, forward it, and emit events**

Replace the entire contents of `apps/agent/src/nodes/verify.ts` with:

```typescript
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch'
import { HumanMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { Runnable } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

export function createVerifyNode(verifyGraph: Runnable) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')

    // Only check for edits after the last user message (not full history)
    const lastUserIdx = state.messages.lastIndexOf(lastUserMessage!)
    const currentTurnMessages =
      lastUserIdx >= 0 ? state.messages.slice(lastUserIdx) : state.messages
    const hasEdits = currentTurnMessages.some(
      m => m.type === 'tool' && ['file_edit', 'file_write', 'shell'].includes(m.name ?? '')
    )

    if (!hasEdits) return { verifyVerdict: 'PASS' }

    await dispatchCustomEvent('phase_start', { phase: 'verify' }, config)

    const prompt = `Verify the implementation. Original task: ${String(lastUserMessage?.content ?? 'unknown')}`

    const result = await verifyGraph.invoke({ messages: [new HumanMessage(prompt)] }, config)

    const lastMessage = [...result.messages]
      .reverse()
      .find((m: { type: string }) => m.type === 'ai')
    const output = String(lastMessage?.content ?? '')

    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/)
    const verdict = (verdictMatch?.[1] ?? 'PARTIAL') as 'PASS' | 'FAIL' | 'PARTIAL'

    await dispatchCustomEvent('phase_end', { phase: 'verify' }, config)

    return {
      verifyVerdict: verdict,
      critiqueFeedback: verdict !== 'PASS' ? output : null,
      critiqueAttempts: state.critiqueAttempts + (verdict !== 'PASS' ? 1 : 0),
    }
  }
}
```

Note: when no edits are detected, we skip the phase events entirely so no empty block renders.

- [ ] **Step 2: Verify the agent app has no type errors**

Run: `cd apps/agent && npx tsc --noEmit`
Expected: No errors related to this change.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/nodes/verify.ts
git commit -m "feat: forward config and emit phase events in verify node"
```

---

### Task 3: Backend — Update plan node to emit phase events

**Files:**

- Modify: `apps/agent/src/nodes/plan.ts`

- [ ] **Step 1: Update the plan node to accept config and emit events**

Replace the entire contents of `apps/agent/src/nodes/plan.ts` with:

```typescript
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

const PLAN_SYSTEM_PROMPT = `You are an implementation planner. Produce a concise, numbered implementation plan.

Format:
1. [specific action] in [specific file]
2. [specific action] in [specific file]
...

Rules:
- Be specific about file paths and what changes
- Keep it under 10 steps
- No code, just the plan
- If the task is a question or doesn't require changes, write "No implementation needed — this is an informational request"`

export function createPlanNode(model: BaseChatModel) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    await dispatchCustomEvent('phase_start', { phase: 'plan' }, config)

    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) {
      await dispatchCustomEvent('phase_end', { phase: 'plan' }, config)
      return {}
    }

    const contextParts = [String(lastUserMessage.content)]
    if (state.exploreSummary) {
      contextParts.unshift(`Exploration findings:\n${state.exploreSummary}\n\nUser request:`)
    }

    const response = await model.invoke([
      new SystemMessage(PLAN_SYSTEM_PROMPT),
      new HumanMessage(contextParts.join(' ')),
    ])

    await dispatchCustomEvent('phase_end', { phase: 'plan' }, config)
    return { plan: String(response.content) }
  }
}
```

- [ ] **Step 2: Verify the agent app has no type errors**

Run: `cd apps/agent && npx tsc --noEmit`
Expected: No errors related to this change.

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/nodes/plan.ts
git commit -m "feat: emit phase events in plan node"
```

---

### Task 4: Frontend — Add PhaseGroup type and PhaseBlock component

**Files:**

- Modify: `apps/web/src/components/ui/chat-message.tsx`

- [ ] **Step 1: Add the PhaseGroup type export and PhaseBlock component**

Add the following type after the existing `Message` interface (after line 131 in `chat-message.tsx`):

```typescript
export interface PhaseInfo {
  name: 'explore' | 'plan' | 'verify'
  startIdx: number
  endIdx: number | null
}

export interface PhaseGroup {
  type: 'phase-group'
  phase: PhaseInfo
  messages: Message[]
}
```

Add the following imports to the existing lucide-react import (line 4):

```typescript
import { ChevronRight, Code2, ListChecks, Loader2, Search, ShieldCheck } from 'lucide-react'
```

Add the `PhaseBlock` component after the `ReasoningBlock` component (after line 292):

```typescript
const PHASE_CONFIG = {
  explore: { runningLabel: 'Exploring codebase...', doneLabel: 'Explored codebase', Icon: Search },
  plan: { runningLabel: 'Planning...', doneLabel: 'Planned implementation', Icon: ListChecks },
  verify: { runningLabel: 'Verifying...', doneLabel: 'Verified implementation', Icon: ShieldCheck },
} as const

export function PhaseBlock({ group }: { group: PhaseGroup }) {
  const config = PHASE_CONFIG[group.phase.name]
  const isRunning = group.phase.endIdx === null
  const label = isRunning ? config.runningLabel : config.doneLabel
  const icon = isRunning ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : (
    <config.Icon className="h-4 w-4" />
  )

  return (
    <CollapsibleBlock icon={icon} title={label}>
      <div className="space-y-3">
        {group.messages.map((message, index) => (
          <ChatMessage key={index} {...message} animation="none" />
        ))}
      </div>
    </CollapsibleBlock>
  )
}
```

- [ ] **Step 2: Verify the web app builds**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/chat-message.tsx
git commit -m "feat: add PhaseGroup type and PhaseBlock component"
```

---

### Task 5: Frontend — Update MessageList to handle PhaseGroup items

**Files:**

- Modify: `apps/web/src/components/ui/message-list.tsx`

- [ ] **Step 1: Update MessageList to render both Message and PhaseGroup items**

Replace the entire contents of `apps/web/src/components/ui/message-list.tsx` with:

```typescript
import type { ChatMessageProps, Message, PhaseGroup } from '@/components/ui/chat-message'
import { ChatMessage, PhaseBlock } from '@/components/ui/chat-message'
import { TypingIndicator } from '@/components/ui/typing-indicator'

export type MessageListItem = Message | PhaseGroup

function isPhaseGroup(item: MessageListItem): item is PhaseGroup {
  return 'type' in item && item.type === 'phase-group'
}

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
      {messages.map((item, index) => {
        if (isPhaseGroup(item)) {
          if (item.messages.length === 0) return null
          return <PhaseBlock key={`phase-${item.phase.name}-${index}`} group={item} />
        }

        const additionalOptions =
          typeof messageOptions === 'function' ? messageOptions(item) : messageOptions

        return (
          <ChatMessage
            key={index}
            showTimeStamp={showTimeStamps}
            {...item}
            {...additionalOptions}
          />
        )
      })}
      {isTyping && <TypingIndicator />}
    </div>
  )
}
```

- [ ] **Step 2: Verify the web app builds**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/message-list.tsx
git commit -m "feat: update MessageList to render PhaseGroup items"
```

---

### Task 6: Frontend — Wire up phase tracking and message grouping in the route

**Files:**

- Modify: `apps/web/src/routes/_layout.$threadId.tsx`

This is the most complex task. We need to:

1. Add `streamSubgraphs: true` to submit and joinStream
2. Add `onCustomEvent` callback to `useStream` to track phase boundaries
3. Update the `useMemo` to group messages into PhaseGroups based on phase boundaries

- [ ] **Step 1: Update imports**

At the top of `apps/web/src/routes/_layout.$threadId.tsx`, update the imports:

Change line 5 from:

```typescript
import type { Message, ToolInvocationPart } from '@/components/ui/chat-message'
```

to:

```typescript
import type {
  Message,
  PhaseGroup,
  PhaseInfo,
  ToolInvocationPart,
} from '@/components/ui/chat-message'
```

Change line 6 from:

```typescript
import { MessageList } from '@/components/ui/message-list'
```

to:

```typescript
import { MessageList, type MessageListItem } from '@/components/ui/message-list'
```

Add `useCallback` to the React import on line 3:

```typescript
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 2: Add phase tracking state and onCustomEvent callback**

Inside the `RouteComponent` function, after the `stream` declaration (after line 38), add:

```typescript
const [phases, setPhases] = useState<PhaseInfo[]>([])
const messagesLengthRef = useRef(0)

// Keep a ref of current messages length for use in onCustomEvent callback
useEffect(() => {
  messagesLengthRef.current = stream.messages.length
}, [stream.messages.length])
```

Then update the `useStream` call to add the `onCustomEvent` callback. Add this property inside the `useStream` options object (after the `onFinish` callback, before the closing `}`):

```typescript
    onCustomEvent: (event: { type: string; phase: PhaseInfo['name'] }) => {
      if (event.type === 'phase_start') {
        setPhases(prev => [
          ...prev,
          { name: event.phase, startIdx: messagesLengthRef.current, endIdx: null },
        ])
      }
      if (event.type === 'phase_end') {
        setPhases(prev =>
          prev.map(p =>
            p.name === event.phase && p.endIdx === null
              ? { ...p, endIdx: messagesLengthRef.current }
              : p
          )
        )
      }
    },
```

Also reset phases when a new thread is opened. Add after the `phases` state declaration:

```typescript
// Reset phases when thread changes
useEffect(() => {
  setPhases([])
}, [threadId])
```

- [ ] **Step 3: Add streamSubgraphs to submit and joinStream**

Update the `stream.submit` call (around line 214) to add `streamSubgraphs: true`:

Change:

```typescript
            { streamMode: ['messages', 'values'], context, config: { recursion_limit: 1000 } }
```

to:

```typescript
            { streamMode: ['messages', 'values'], streamSubgraphs: true, context, config: { recursion_limit: 1000 } }
```

Update the `stream.joinStream` call (around line 46) to add `streamSubgraphs: true`:

Change:

```typescript
        streamMode: ['messages', 'values'],
```

to:

```typescript
        streamMode: ['messages', 'values'],
        streamSubgraphs: true,
```

- [ ] **Step 4: Update the message processing useMemo to group messages by phase**

Replace the entire `messages` useMemo block (lines 53-156) with:

```typescript
const items: Array<MessageListItem> = useMemo(() => {
  // First, transform stream messages into display messages (same as before)
  const allMessages: Array<{ originalIdx: number; message: Message }> = []

  let originalIdx = 0
  for (const message of stream.messages) {
    if (message.type === 'tool') {
      originalIdx++
      continue
    }

    if (
      message.type === 'human' ||
      message.type === 'system' ||
      message.type === 'function' ||
      message.type === 'remove'
    ) {
      allMessages.push({
        originalIdx,
        message: {
          id: message.id!,
          role: message.type === 'human' ? 'user' : 'assistant',
          content: Array.isArray(message.content)
            ? message.content
                .filter(content => content.type === 'text')
                .map(content => content.text)
                .join('')
            : message.content,
        },
      })
      originalIdx++
      continue
    }

    // AI message — split into reasoning, text, tool call parts
    const reasoningContent = message.additional_kwargs?.reasoning_content as string | undefined

    if (reasoningContent) {
      allMessages.push({
        originalIdx,
        message: {
          id: message.id!,
          role: 'assistant',
          content: reasoningContent,
          parts: [{ type: 'reasoning', reasoning: reasoningContent }],
        },
      })
    }

    const messageContent = Array.isArray(message.content)
      ? message.content
          .filter(content => content.type === 'text')
          .map(content => content.text)
          .join('')
      : message.content.toString().trim()

    if (messageContent) {
      allMessages.push({
        originalIdx,
        message: {
          id: message.id!,
          role: 'assistant',
          content: messageContent,
          parts: [{ type: 'text', text: messageContent }],
        },
      })
    }

    const toolCalls = stream.getToolCalls(message)

    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const parts: Array<ToolInvocationPart> = []

        if (toolCall.state === 'pending') {
          parts.push({
            type: 'tool-invocation',
            toolInvocation: {
              args: toolCall.call.args,
              toolName: toolCall.call.name,
              state: 'call',
            },
          })
        }

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
        }

        allMessages.push({
          originalIdx,
          message: {
            id: toolCall.id,
            role: 'assistant',
            content: '',
            parts,
          },
        })
      }
    }

    originalIdx++
  }

  // Now group messages into phases
  const result: Array<MessageListItem> = []
  const phaseGroups = new Map<number, PhaseGroup>()

  // Build phase groups
  for (const phase of phases) {
    const group: PhaseGroup = { type: 'phase-group', phase, messages: [] }
    phaseGroups.set(phases.indexOf(phase), group)
  }

  // Track which phase group indices we've already inserted
  const insertedPhases = new Set<number>()

  for (const { originalIdx, message } of allMessages) {
    // Find which phase this message belongs to
    let assignedPhase: number | null = null
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]
      const end = phase.endIdx ?? stream.messages.length
      if (originalIdx >= phase.startIdx && originalIdx < end) {
        assignedPhase = i
        break
      }
    }

    if (assignedPhase !== null) {
      // Insert the phase group at the position of its first message
      if (!insertedPhases.has(assignedPhase)) {
        insertedPhases.add(assignedPhase)
        result.push(phaseGroups.get(assignedPhase)!)
      }
      phaseGroups.get(assignedPhase)!.messages.push(message)
    } else {
      result.push(message)
    }
  }

  return result
}, [stream.messages, phases])
```

- [ ] **Step 5: Update MessageList usage to pass items instead of messages**

Change the `<MessageList>` usage (around line 207) from:

```typescript
        <MessageList messages={messages} isTyping={stream.isLoading} />
```

to:

```typescript
        <MessageList messages={items} isTyping={stream.isLoading} />
```

Also update the `useLayoutEffect` that depends on `messages` (around line 176-180). Change:

```typescript
useLayoutEffect(() => {
  const el = scrollContainerRef.current
  if (!el || !stickToBottomRef.current) return
  el.scrollTop = el.scrollHeight
}, [messages, stream.isLoading])
```

to:

```typescript
useLayoutEffect(() => {
  const el = scrollContainerRef.current
  if (!el || !stickToBottomRef.current) return
  el.scrollTop = el.scrollHeight
}, [items, stream.isLoading])
```

And update the `estimatedTokens` useMemo — it references `stream.messages` directly so no change needed there.

- [ ] **Step 6: Verify the web app builds**

Run: `cd apps/web && npx vite build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/_layout.$threadId.tsx
git commit -m "feat: wire up phase tracking, message grouping, and streamSubgraphs"
```

---

### Task 7: Manual integration test

- [ ] **Step 1: Start the agent and web app**

Run: `cd apps/agent && pnpm dev` in one terminal, `cd apps/web && pnpm dev` in another.

- [ ] **Step 2: Test with a task that triggers explore + plan + verify**

Send a message that requires code changes (e.g., "Add a hello world endpoint to the server"). Verify:

- Collapsible blocks appear for "Exploring codebase...", "Planning...", "Verifying..."
- Blocks are collapsed by default
- Clicking a block expands it to show internal messages (tool calls, reasoning, text)
- Blocks show spinner icons while running, then switch to phase-specific icons when done
- Non-phase messages (the main executor's work) render normally outside the blocks

- [ ] **Step 3: Test with a simple question that skips explore/plan**

Send a simple question (e.g., "What does this project do?"). Verify:

- No collapsible phase blocks appear
- Messages render normally as before

- [ ] **Step 4: Final commit with any fixes**

If any fixes were needed during testing, commit them:

```bash
git add -A
git commit -m "fix: address integration test findings for collapsible phase blocks"
```
