# 04 — Graph Architecture

## Prerequisites

This document integrates work from three prior documents:

- **Doc 01 (LLM Setup)**: `codingModel`, `planModel`, `exploreModel` instances exist
- **Doc 02 (Core Tools)**: `fileEditTool`, `grepTool`, `checkShellSafety` exist
- **Doc 03 (Context Management)**: `createMaybeCompactNode`, `estimateMessagesTokens` exist

Complete those before starting this document.

## Overview

The current graph is a straight line: `title-generator → system-prompt → executor ⇄ tools`.

The new graph adds three phases before executor and one after:

```
START
  ↓
command                        detect /compact, /help, etc.
  ↓ not a command    ↓ /help → END    ↓ /compact
maybe-compact                  summarize if > 85% context used or forceCompact
  ↓ (forceCompact → END)
should-plan                    fast model, single call — yes/no
  ↓ yes             ↓ no
explore           system-prompt
subgraph            ↓
  ↓              executor ← (skips explore/plan entirely)
plan node
  ↓
system-prompt                  unchanged, now injects plan + critiqueFeedback
  ↓
executor ←────────────────┐
  ↓                        │
tools ─────────────────────┘
  ↓ end_turn
verify subgraph            coding model, read-only + shell
  ↓ PASS         ↓ FAIL or PARTIAL (attempts < 2)
END         system-prompt (critiqueFeedback = failure output)
                ↓
            executor loop
```

---

## State Schema Changes

The state already has `plan`, `critique`, `critiqueFeedback`, `critiqueAttempts`. Add `exploreSummary` and `verifyVerdict`, remove the unused fields:

```typescript
// graphs/agent.ts
export const agentStateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
  commandHandled: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  forceCompact: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  shouldPlan: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  exploreSummary: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  plan: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  critiqueAttempts: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  critiqueFeedback: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  verifyVerdict: Annotation<'PASS' | 'FAIL' | 'PARTIAL' | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
})
```

Remove `planningDepth`, `complexity`, and `critique` — they were never used and add noise.

---

## 1. Command Node

First node in the graph. Checks if the last user message is a `/` command. If so, handles it and sets `commandHandled: true` to short-circuit to END. Otherwise passes through.

```typescript
// nodes/command.ts
import { AIMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'

const COMMANDS: Record<string, (state: AgentState) => Partial<AgentState>> = {
  '/compact': () => ({
    commandHandled: true,
    forceCompact: true,
    messages: [new AIMessage({ content: '[compacting conversation...]' })],
  }),
  '/help': () => ({
    commandHandled: true,
    messages: [
      new AIMessage({
        content:
          'Available commands:\n  /compact   Summarize conversation and free up context\n  /help      Show this message\n  /exit      Exit the agent',
      }),
    ],
  }),
}

export function createCommandNode() {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const lastMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastMessage) return { commandHandled: false }

    const input = String(lastMessage.content).trim()
    const commandName = input.split(' ')[0]
    const handler = COMMANDS[commandName]

    if (handler) return handler(state)
    return { commandHandled: false }
  }
}
```

Routing from the command node:

```typescript
.addConditionalEdges('command', s => (s.commandHandled ? END : 'maybe-compact'))
```

Wait — `/compact` needs to actually run `maybe-compact` before exiting. Update the routing:

```typescript
.addConditionalEdges('command', s => {
  if (!s.commandHandled) return 'maybe-compact'    // normal flow
  if (s.forceCompact) return 'maybe-compact'        // /compact needs to run compaction
  return END                                         // /help etc. — done
})
```

And `maybe-compact` needs to route to END after a forced compact instead of continuing:

```typescript
.addConditionalEdges('maybe-compact', s => (s.forceCompact ? END : 'should-plan'))
```

Adding new commands in the future is just adding a key to the `COMMANDS` map.

---

## 2. Should-Plan Gate

A single fast-model call that classifies whether the request warrants explore + plan. Returns `true` or `false`. No tools, no loop.

```typescript
// nodes/should-plan.ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'

const GATE_PROMPT = `Does this request require understanding the codebase before acting?

Answer YES if:
- The task involves multiple files or unknown file locations
- It requires understanding existing patterns before implementing
- It's a non-trivial feature or refactor
- The scope is unclear from the request alone

Answer NO if:
- It's a question (what, why, how, show me, explain)
- It's a single obvious file change ("fix the typo in X", "add Y to Z")
- It's a follow-up on something already discussed
- It doesn't involve code changes

Reply with exactly one word: yes or no`

export function createShouldPlanNode(fastModel: BaseChatModel) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return { shouldPlan: false }

    const response = await fastModel.invoke([
      new SystemMessage(GATE_PROMPT),
      new HumanMessage(String(lastUserMessage.content)),
    ])

    const answer = String(response.content).trim().toLowerCase()
    return { shouldPlan: answer === 'yes' }
  }
}
```

(`shouldPlan` is already in the state schema above.)

Edge from gate:

```typescript
.addConditionalEdges('should-plan', (s) => s.shouldPlan ? 'explore' : 'system-prompt')
```

---

## 3. Explore Subgraph

A separate compiled graph. Uses fast model + read-only tools. Loops until the model stops calling tools, then returns a summary.

```typescript
// graphs/exploreGraph.ts
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { SystemMessage } from '@langchain/core/messages'

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration specialist. Your job is to gather information — not to implement anything.

READ-ONLY MODE: Do not create, edit, or delete files. Do not run commands that modify state (no git add/commit, no npm install, no mkdir).

Allowed shell commands: ls, find, cat, head, tail, git log, git diff, git status, git show, wc

When you have gathered enough information, stop calling tools and write a structured summary:
- Relevant files and their purposes
- Existing patterns to follow
- Potential gotchas or constraints
- Suggested approach (high level only)

Be thorough. The plan node will use your summary to produce an implementation plan.`

export function createExploreGraph(fastModel: BaseChatModel, readOnlyTools: StructuredTool[]) {
  const modelWithTools = fastModel.bindTools(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools)

  async function exploreExecutor(state: typeof MessagesAnnotation.State) {
    // Inject system prompt on first call
    const hasSystem = state.messages.some(m => m.type === 'system')
    const messages = hasSystem
      ? state.messages
      : [new SystemMessage(EXPLORE_SYSTEM_PROMPT), ...state.messages]

    const response = await modelWithTools.invoke(messages)
    return { messages: [response] }
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('executor', exploreExecutor)
    .addNode('tools', toolNode)
    .addEdge(START, 'executor')
    .addConditionalEdges('executor', toolsCondition, {
      tools: 'tools',
      __end__: END,
    })
    .addEdge('tools', 'executor')
    .compile()
}
```

The explore node in the parent graph:

```typescript
// nodes/explore.ts
export function createExploreNode(exploreGraph: CompiledGraph) {
  return async (state: AgentState, runtime: Runtime): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return {}

    const result = await exploreGraph.invoke(
      {
        messages: [lastUserMessage],
      },
      {
        configurable: { ...runtime.configurable },
      }
    )

    // Extract final assistant message as the exploration summary
    const lastMessage = [...result.messages].reverse().find(m => m.type === 'ai')
    const summary = lastMessage ? String(lastMessage.content) : ''

    return { exploreSummary: summary }
  }
}
```

---

## 4. Plan Node

Single fast-model call. Takes the exploration summary (if available) and the user request, produces a numbered implementation plan.

```typescript
// nodes/plan.ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'
import type { Runtime } from 'langchain'

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

export function createPlanNode(fastModel: BaseChatModel) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return {}

    const contextParts = [String(lastUserMessage.content)]
    if (state.exploreSummary) {
      contextParts.unshift(`Exploration findings:\n${state.exploreSummary}\n\nUser request:`)
    }

    const response = await fastModel.invoke([
      new SystemMessage(PLAN_SYSTEM_PROMPT),
      new HumanMessage(contextParts.join(' ')),
    ])

    return { plan: String(response.content) }
  }
}
```

---

## 5. Verify Subgraph

Similar structure to explore but uses the coding model and has access to shell (for running builds/tests). Read-only file access — no edits.

```typescript
// graphs/verifyGraph.ts

const VERIFY_SYSTEM_PROMPT = `You are a verification specialist. Your job is to prove the implementation works — not to assume it does.

Steps:
1. Read the project's package.json / Makefile for build and test commands
2. Run the build if applicable. A broken build is an automatic FAIL.
3. Run the test suite if one exists. Failing tests are an automatic FAIL.
4. Run typechecks if configured (tsc, mypy, etc.)
5. Spot-check the actual behavior — run the code, hit the endpoint, call the function

For every check, record:
- Exact command run
- Actual output (copy-paste, not paraphrased)
- PASS or FAIL with expected vs actual

When you cannot run a check (no test suite, server can't start, tool unavailable):
- State what could not be verified and why
- Issue VERDICT: PARTIAL

End with exactly one of:
VERDICT: PASS
VERDICT: FAIL
VERDICT: PARTIAL

PARTIAL is for environmental limitations only — not for "I'm unsure." If you can run the check, you must decide PASS or FAIL.`

export function createVerifyGraph(codingModel: BaseChatModel, verifyTools: StructuredTool[]) {
  // verifyTools = [fileReadTool, fileSearchTool, grepTool, shellTool]
  // shell is included but the system prompt restricts to read/run operations
  const modelWithTools = codingModel.bindTools(verifyTools)
  const toolNode = new ToolNode(verifyTools)

  // Same pattern as exploreGraph — inject system prompt on first call
  async function verifyExecutor(state: typeof MessagesAnnotation.State) {
    const hasSystem = state.messages.some(m => m.type === 'system')
    const messages = hasSystem
      ? state.messages
      : [new SystemMessage(VERIFY_SYSTEM_PROMPT), ...state.messages]

    const response = await modelWithTools.invoke(messages)
    return { messages: [response] }
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('executor', verifyExecutor)
    .addNode('tools', toolNode)
    .addEdge(START, 'executor')
    .addConditionalEdges('executor', toolsCondition, { tools: 'tools', __end__: END })
    .addEdge('tools', 'executor')
    .compile()
}
```

The verify node in the parent graph:

```typescript
// nodes/verify.ts
export function createVerifyNode(verifyGraph: CompiledGraph) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    // Only verify if something was actually implemented
    const hasEdits = state.messages.some(
      m =>
        m.type === 'tool' &&
        ['file_edit', 'file_write', 'shell'].includes((m as ToolMessage).name ?? '')
    )
    if (!hasEdits) return { verifyVerdict: 'PASS' }

    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    const prompt = `Verify the implementation. Original task: ${String(lastUserMessage?.content ?? 'unknown')}`

    const result = await verifyGraph.invoke({ messages: [new HumanMessage(prompt)] })
    const lastMessage = [...result.messages].reverse().find(m => m.type === 'ai')
    const output = String(lastMessage?.content ?? '')

    // Parse verdict
    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/)
    const verdict = (verdictMatch?.[1] ?? 'PARTIAL') as 'PASS' | 'FAIL' | 'PARTIAL'

    return {
      verifyVerdict: verdict,
      critiqueFeedback: verdict !== 'PASS' ? output : null,
      critiqueAttempts: state.critiqueAttempts + (verdict !== 'PASS' ? 1 : 0),
    }
  }
}
```

---

## 6. Conditional Edge After Verify

```typescript
.addConditionalEdges('verify', (state) => {
  if (state.verifyVerdict === 'PASS') return END
  if (state.critiqueAttempts >= 2) return END        // bail after 2 failed attempts
  return 'system-prompt'                             // retry with failure output injected
})
```

When routing back to `system-prompt`, there's already a system message in state. The current `systemPromptNode` skips injection if a system message exists. Fix this:

```typescript
// nodes/system-prompt.ts
import { RemoveMessage } from '@langchain/core/messages'

export async function systemPromptNode(state: AgentState, runtime: Runtime) {
  // Always rebuild if critiqueFeedback changed (retry path)
  const existingSystem = state.messages.find(m => m.type === 'system')
  if (existingSystem && !state.critiqueFeedback) return {}

  const systemMessage = await buildSystemPrompt(runtime, state.plan, state.critiqueFeedback)

  // IMPORTANT: MessagesAnnotation uses an additive reducer. To replace
  // the system message, remove the old one first then add the new one.
  if (existingSystem) {
    return {
      messages: [new RemoveMessage({ id: existingSystem.id! }), systemMessage],
    }
  }
  return { messages: [systemMessage] }
}
```

---

## 7. Full Graph Wiring

```typescript
// graphs/agent.ts
export async function createAgent() {
  const { codingModel, fastModel, planModel } = createModels()

  const readOnlyTools = [fileSearchTool, fileReadTool, grepTool]
  const allTools = [
    ...readOnlyTools,
    fileEditTool,
    fileWriteTool,
    shellTool,
    ...(await client.getTools()),
  ]
  const verifyTools = [...readOnlyTools, shellTool]

  const exploreGraph = createExploreGraph(fastModel, readOnlyTools)
  const verifyGraph = createVerifyGraph(codingModel, verifyTools)

  const executorNode = createExecutorNode(codingModel.bindTools(allTools), env.CODING_MODEL)
  const toolNode = new ToolNode(allTools, { handleToolErrors: true })

  return new StateGraph(agentStateSchema)
    .addNode('command', createCommandNode())
    .addNode('maybe-compact', createMaybeCompactNode(fastModel))
    .addNode('should-plan', createShouldPlanNode(fastModel))
    .addNode('explore', createExploreNode(exploreGraph))
    .addNode('plan', createPlanNode(planModel))
    .addNode('system-prompt', systemPromptNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addNode('verify', createVerifyNode(verifyGraph))

    .addEdge(START, 'command')
    .addConditionalEdges('command', s => {
      if (!s.commandHandled) return 'maybe-compact' // normal flow
      if (s.forceCompact) return 'maybe-compact' // /compact needs compaction
      return END // /help etc. — done
    })
    .addConditionalEdges('maybe-compact', s => (s.forceCompact ? END : 'should-plan'))
    .addConditionalEdges('should-plan', s => (s.shouldPlan ? 'explore' : 'system-prompt'))
    .addEdge('explore', 'plan')
    .addEdge('plan', 'system-prompt')
    .addEdge('system-prompt', 'executor')
    .addConditionalEdges('executor', toolsCondition, {
      tools: 'tools',
      __end__: 'verify',
    })
    .addEdge('tools', 'executor')
    .addConditionalEdges('verify', s => {
      if (s.verifyVerdict === 'PASS') return END
      if (s.critiqueAttempts >= 2) return END
      return 'system-prompt'
    })
    .compile()
}
```

Note: `toolsCondition` from LangGraph routes to `__end__` when there are no tool calls. Map `__end__` to `verify` instead of `END`.
