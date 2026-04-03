# Collapsible Subgraph Phase Blocks

**Date:** 2026-04-02
**Status:** Approved

## Problem

The agent has three internal phases — explore, plan, and verify — that run as subgraphs or dedicated LLM calls. Currently, these phases produce zero visible output in the web UI. The user stares at a loading spinner with no insight into what's happening. Thinking blocks and tool calls already have collapsible toggles, but subgraph executions don't.

## Solution

Add collapsible blocks for each phase (explore, plan, verify) in the web UI, matching the existing toggle pattern used for thinking and tool call messages. Each block shows a static label, starts collapsed, and can be expanded to reveal the internal messages (tool calls, reasoning, text) produced during that phase.

## Design Decisions

- **Grouping:** All messages from a single subgraph phase are wrapped in one collapsible block.
- **Collapsed state:** Static label (e.g., "Exploring codebase..."). No dynamic summary.
- **Default state:** Always collapsed. User opts in to expand.
- **Plan treatment:** Gets its own collapsible block, consistent with explore/verify, even though it's a single LLM call.

## Backend — Config Forwarding & Custom Events

### Current structure

Explore and verify are wrapper functions that call `.invoke()` on compiled subgraphs internally. Plan is a plain function node. None of them forward the LangGraph `config` parameter, so subgraph stream events don't propagate to the client.

```
should-plan → explore (wrapper) → make-plan (function) → system-prompt → executor ↔ tools → verify (wrapper)
```

### New structure

The graph topology stays the same. The change is minimal: each wrapper node accepts the `config` parameter, forwards it to the subgraph `.invoke()` call, and emits custom events for phase boundaries.

LangGraph injects the parent's stream object into `config` via `CONFIG_KEY_STREAM`. When the wrapper forwards `config` to the subgraph's `.invoke()`, the subgraph's `PregelLoop` detects the parent stream and creates a duplex stream — events from the subgraph propagate to the parent's SSE stream automatically.

### Wrapper node changes

Each wrapper node gets three additions:

1. Accept `config: RunnableConfig` as second parameter
2. Forward `config` to the subgraph `.invoke()` call
3. Emit `phase_start` / `phase_end` custom events via `dispatchCustomEvent`

Example (explore node):

```typescript
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch'
import type { RunnableConfig } from '@langchain/core/runnables'

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

### Plan node

Plan is a single LLM call, not a subgraph. It emits `phase_start`/`phase_end` events around the model invocation. Since it's not a subgraph, there are no internal messages to stream — when expanded, the collapsible block shows the plan text as a single message. The plan node accepts `config` and uses it for `dispatchCustomEvent`.

### Verify skip logic

When verify detects no edits were made, it emits `phase_start` and `phase_end` immediately with no subgraph invocation in between. The frontend filters out empty phase groups — nothing renders.

### Files changed (backend)

| File                              | Change                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/agent/src/nodes/explore.ts` | Accept `config`, forward to `.invoke()`, emit phase events.                             |
| `apps/agent/src/nodes/verify.ts`  | Accept `config`, forward to `.invoke()`, emit phase events.                             |
| `apps/agent/src/nodes/plan.ts`    | Accept `config`, emit phase events around model invocation.                             |
| `apps/agent/src/graphs/agent.ts`  | No structural changes. Ensure `streamSubgraphs` support is not blocked by graph config. |

## Frontend — Phase Tracking & Message Grouping

### Stream configuration

Two changes to the stream setup:

1. Add `streamSubgraphs: true` to `stream.submit()` options — enables subgraph message streaming.
2. Add `onCustomEvent` callback to `useStream()` — receives phase boundary events.

Also add `streamSubgraphs: true` to `stream.joinStream()` for resumed streams.

### Phase state tracking

A React state tracks active phases and their message index boundaries:

```typescript
interface Phase {
  name: 'explore' | 'plan' | 'verify'
  label: string
  startIdx: number
  endIdx: number | null // null = still running
}
```

The `onCustomEvent` callback updates this state:

- `phase_start` → append a new Phase with `startIdx` = current `stream.messages.length`, `endIdx` = null
- `phase_end` → set matching Phase's `endIdx` = current `stream.messages.length`

### Message grouping

The existing `useMemo` that transforms `stream.messages` into display messages is extended:

1. Iterate through messages as today.
2. For each message, check if its index falls within any Phase's `[startIdx, endIdx]` range.
3. Phase messages are collected into a `PhaseGroup` object instead of being added to the flat list.
4. Non-phase messages render normally.

Output type changes from `Array<Message>` to `Array<Message | PhaseGroup>`:

```typescript
interface PhaseGroup {
  type: 'phase-group'
  phase: Phase
  messages: Message[]
}
```

### Rendering

`MessageList` handles the new `PhaseGroup` type:

```
<MessageList items={items}>
  ├─ <ChatMessage>       (regular messages — unchanged)
  └─ <PhaseBlock>        (new — wraps a phase group)
      └─ <CollapsibleBlock>
          ├─ title: static label
          ├─ icon: Loader2 while running, phase-specific icon when done
          └─ children: <ChatMessage> for each grouped message
```

`PhaseBlock` reuses the existing `CollapsibleBlock` component (Radix Collapsible + Framer Motion).

### Phase labels and icons

| Phase   | Running label         | Done label              | Running icon         | Done icon     |
| ------- | --------------------- | ----------------------- | -------------------- | ------------- |
| explore | Exploring codebase... | Explored codebase       | `Loader2` (spinning) | `Search`      |
| plan    | Planning...           | Planned implementation  | `Loader2` (spinning) | `ListChecks`  |
| verify  | Verifying...          | Verified implementation | `Loader2` (spinning) | `ShieldCheck` |

### Files changed (frontend)

| File                                          | Change                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/routes/_layout.$threadId.tsx`   | Add `streamSubgraphs: true`, `onCustomEvent` callback, phase tracking state, updated message grouping logic. |
| `apps/web/src/components/ui/chat-message.tsx` | Add `PhaseBlock` component. Export `PhaseGroup` type.                                                        |
| `apps/web/src/components/ui/message-list.tsx` | Handle `PhaseGroup` items alongside regular `Message` items.                                                 |

## Edge Cases

### Retry loop (verify fails, re-execute, verify again)

Each verify cycle emits its own `phase_start`/`phase_end` pair with distinct message index ranges. Two separate "Verifying..." blocks render — correct behavior since each is a distinct attempt.

### Stream reconnection / `joinStream`

Custom events are ephemeral and don't replay on reconnection. For resumed streams, phase boundary info is unavailable, so all messages render flat without collapsible groups. This is acceptable — grouping historical messages would require persisted phase metadata, which is out of scope.

### No explore/plan phases (`should-plan` returns false)

The graph skips to `system-prompt → executor`. No phase events emit, no collapsible blocks appear. Verify still runs if edits were made.

### Empty verify (no edits made)

The verify wrapper detects no edits, emits `phase_start` + `phase_end` immediately with no subgraph invocation between them. Frontend filters out empty phase groups — nothing renders.

### Event ordering

Custom events and message events share the same SSE connection. `phase_start` always arrives before the subgraph's first message. No race condition.

## Out of Scope

- Dynamic summaries in collapsed state (e.g., showing explore findings or verdict)
- Persisting phase metadata for reconnection scenarios
- Nested subgraph phases (subgraph within subgraph)
- Phase duration or timing display
