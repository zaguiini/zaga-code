# 06 — Enter Planning Mode (Future Improvement)

## What This Is

An upgrade to the `should-plan` gate from doc 04. Instead of classifying upfront from the user's words alone, the executor itself decides mid-turn whether it needs to explore and plan before proceeding. The model has far better signal than a gate: it can see the request, its own uncertainty, and any codebase context already in the conversation.

This is how other LLM-based agents handle it — `EnterPlanMode` is a tool the model calls when it decides exploration is warranted.

---

## How It Changes the Graph

The gate is removed. Instead, `enter_planning` becomes a tool in the executor's tool list. When called, the graph detects it and routes to explore → plan → back to executor with the plan injected.

```
START
  ↓
maybe-compact
  ↓
system-prompt
  ↓
executor ←─────────────────────────────────┐
  ↓                                         │
calls enter_planning()?                     │
  ↓ yes             ↓ no (regular tools)    │
explore           tools ───────────────────┘
subgraph
  ↓
plan node
  ↓
system-prompt (plan injected, planning flag cleared)
  ↓
executor (now implements with plan in context)
  ↓
verify subgraph
```

Key difference from the gate: the executor runs first. It reads the request, optionally checks a file or two, then decides whether it needs a full explore/plan pass. A simple request never triggers it. A complex one does, and the model makes that call with full context.

---

## The `enter_planning` Tool

A no-op tool — it takes no input and does nothing except signal to the graph that planning was requested. The graph detects it via a conditional edge.

```typescript
// tools/enter-planning.ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export const ENTER_PLANNING_TOOL_NAME = 'enter_planning'

export const enterPlanningTool = tool(
  async () => 'Planning mode initiated. Explore the codebase, then produce a plan.',
  {
    name: ENTER_PLANNING_TOOL_NAME,
    description:
      'Call this when you need to explore the codebase and produce a plan before implementing. Use when the task is complex, spans multiple files, or requires understanding existing patterns first. Do NOT use for simple changes or questions.',
    schema: z.object({}),
  }
)
```

---

## Graph Changes

The conditional edge after executor needs to detect `enter_planning` calls alongside regular tool calls:

```typescript
// utils/routing.ts
import { ENTER_PLANNING_TOOL_NAME } from '@/tools/enter-planning'
import type { AgentState } from '@/graphs/agent'

export function executorRouter(state: AgentState): 'tools' | 'explore' | 'verify' {
  const lastMessage = state.messages.at(-1)
  if (!lastMessage || lastMessage.type !== 'ai') return 'verify'

  const toolCalls = (lastMessage as AIMessage).tool_calls ?? []
  if (toolCalls.length === 0) return 'verify'

  // If enter_planning was called (possibly alongside other tool calls), route to explore
  if (toolCalls.some(tc => tc.name === ENTER_PLANNING_TOOL_NAME)) return 'explore'

  return 'tools'
}
```

```typescript
// In graph wiring:
.addConditionalEdges('executor', executorRouter, {
  tools: 'tools',
  explore: 'explore',
  verify: 'verify',
})
```

Add a `planning` flag to state so `system-prompt` knows to rebuild with the plan after the explore/plan cycle:

```typescript
planningRequested: Annotation<boolean>({
  reducer: (_, next) => next,
  default: () => false,
}),
```

Set it to `true` in the explore node entry, `false` after plan injects into system-prompt.

---

## The Explore Node Entry Point

When entering explore from `enter_planning`, the executor may have already made some tool calls in the same turn (reading a file to assess complexity, for example). Those tool results should be passed as context to the explore subgraph so it doesn't repeat work:

```typescript
// nodes/explore.ts (updated)
export function createExploreNode(exploreGraph: CompiledGraph) {
  return async (state: AgentState, runtime: Runtime): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')

    // Include any tool results from the current executor turn as context
    const recentToolResults = getRecentToolResults(state.messages)

    const initialMessages = [
      lastUserMessage,
      ...recentToolResults, // don't re-read files already read
    ].filter(Boolean)

    const result = await exploreGraph.invoke(
      { messages: initialMessages },
      {
        configurable: { ...runtime.configurable },
      }
    )

    const lastMessage = [...result.messages].reverse().find(m => m.type === 'ai')
    return {
      exploreSummary: lastMessage ? String(lastMessage.content) : '',
      planningRequested: true,
    }
  }
}
```

---

## System Prompt Handling

When routing back to `system-prompt` after plan (the planning cycle complete), the existing system message needs to be replaced with the plan injected. The `planningRequested` flag signals this:

```typescript
// nodes/system-prompt.ts (updated)
export async function systemPromptNode(state: AgentState, runtime: Runtime) {
  const existingSystem = state.messages.find(m => m.type === 'system')

  // Rebuild if: no system message yet, critiqueFeedback changed, or planning just completed
  const needsRebuild = !existingSystem || state.critiqueFeedback || state.planningRequested
  if (!needsRebuild) return {}

  const systemMessage = await buildSystemPrompt(runtime, state.plan, state.critiqueFeedback)
  // ... replace or inject as before
}
```

---

## What You Gain vs the Gate

|                       | Gate (`should-plan`)                  | `enter_planning` tool                 |
| --------------------- | ------------------------------------- | ------------------------------------- |
| Classification signal | User's words only                     | Full request + any files already read |
| False positives       | Some (over-plans simple requests)     | Fewer — model has more context        |
| False negatives       | Some (misses subtle complex requests) | Fewer — model can reassess mid-turn   |
| Graph complexity      | Simple, linear                        | Cycle required                        |
| Implementation effort | Low                                   | Medium                                |
| Debuggability         | Easy — one prompt to tune             | Harder — depends on model behavior    |

The gate is the right starting point. Move to `enter_planning` once you have real usage data showing where the gate gets it wrong.

---

## Migration Path

1. Ship the gate (doc 04)
2. Log which turns trigger explore/plan and which don't
3. Identify patterns where the gate over- or under-triggers
4. Use that data to tune the gate prompt first — often enough
5. If the gate consistently fails on a class of requests that need runtime context to classify, migrate to `enter_planning`

The graph change is surgical: remove `should-plan`, add `enter_planning` to the executor's tool list, update `executorRouter`. The explore/plan/verify subgraphs are unchanged.
