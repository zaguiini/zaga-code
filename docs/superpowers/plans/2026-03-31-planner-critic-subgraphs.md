# Planner & Critic Subgraphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the planner and critic nodes into ReAct subgraphs that use `file_read` and `file_search` to explore the codebase before producing their output.

**Architecture:** Each subgraph runs an internal `research → tools → research → ... → synthesize` loop. The research LLM has read-only tools bound; once it stops issuing tool calls, the synthesize LLM produces the final output (plan string or critique struct). Each subgraph is a plain node from the parent graph's perspective — it accepts parent state and returns a partial state update.

**Tech Stack:** `@langchain/langgraph` (StateGraph, MessagesAnnotation, ToolNode, toolsCondition), `@langchain/core` (BaseChatModel, SystemMessage, HumanMessage), existing `fileReadTool` and `fileSearchTool`, Langfuse.

---

## File Map

| Action | Path                             | Responsibility                                                      |
| ------ | -------------------------------- | ------------------------------------------------------------------- |
| Create | `src/graphs/planner-subgraph.ts` | Planner ReAct subgraph + node factory                               |
| Create | `src/graphs/critic-subgraph.ts`  | Critic ReAct subgraph + node factory + `shouldRetry`                |
| Modify | `src/graphs/agent.ts`            | Import new factories, pass read-only tools, remove old node imports |
| Delete | `src/nodes/planner.ts`           | Replaced by planner-subgraph.ts                                     |
| Delete | `src/nodes/critic.ts`            | Replaced by critic-subgraph.ts                                      |

---

## Task 1: Create planner subgraph

**Files:**

- Create: `apps/api/src/graphs/planner-subgraph.ts`

### How it works

The node factory builds a compiled subgraph once. The subgraph has its own state (`MessagesAnnotation` + `planningDepth`). The parent node function maps parent state → subgraph input, invokes the subgraph, and extracts the plan from the final message.

Subgraph flow: `START → research → [toolsCondition] → tools → research (loop) | synthesize → END`

- `research` node: reasoning model with `file_read` + `file_search` bound. Explores the codebase until no more tool calls.
- `tools` node: `ToolNode` with read-only tools.
- `synthesize` node: reasoning model (no tools). Receives the full research transcript plus a fresh system prompt instructing it to write the plan.

- [ ] **Step 1: Write `src/graphs/planner-subgraph.ts`**

```typescript
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const RESEARCH_SYSTEM_PROMPT = `You are researching a codebase to prepare an implementation plan. Use file_search to locate relevant files and file_read to read them. Follow imports, check existing conventions and patterns. When you have enough context to write an accurate plan, stop making tool calls.`

const DEPTH_INSTRUCTIONS: Record<'brief' | 'detailed' | 'decomposed', string> = {
  brief: `Create a brief 2-3 step implementation plan. Focus on what needs to be delivered and in what order. Keep it concise.`,
  detailed: `Create a detailed numbered implementation plan. List the specific changes to make and the order of operations. Include dependencies between steps.`,
  decomposed: `Break this into sub-tasks with dependencies. For each sub-task: what it does, expected output, and what must be completed before it can start. Number the sub-tasks and mark dependencies explicitly.`,
}

const SYNTHESIZE_SYSTEM_PROMPT = (depth: 'brief' | 'detailed' | 'decomposed') =>
  `You are a planning assistant. You have just explored the codebase. Now write the implementation plan based on what you found.

${DEPTH_INSTRUCTIONS[depth]}

Do not include file discovery or file reading steps — you have already done that.
Output ONLY the plan as markdown. No preamble, no explanation.`

const PlannerSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  planningDepth: Annotation<'brief' | 'detailed' | 'decomposed'>({
    reducer: (_, next) => next,
    default: () => 'detailed' as const,
  }),
})

type PlannerSubgraphState = typeof PlannerSubgraphState.State

export function createPlannerNode(model: BaseChatModel, readOnlyTools: StructuredToolInterface[]) {
  const researchModel = model.bindTools(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools, { handleToolErrors: true })

  const researchNode = async (state: PlannerSubgraphState) => {
    const response = await researchModel.invoke(state.messages)
    return { messages: [response] }
  }

  const synthesizeNode = async (state: PlannerSubgraphState) => {
    const response = await model.invoke([
      new SystemMessage(SYNTHESIZE_SYSTEM_PROMPT(state.planningDepth)),
      ...state.messages,
    ])
    return { messages: [response] }
  }

  const subgraph = new StateGraph(PlannerSubgraphState)
    .addNode('research', researchNode)
    .addNode('tools', toolNode)
    .addNode('synthesize', synthesizeNode)
    .addEdge(START, 'research')
    .addConditionalEdges('research', toolsCondition, { tools: 'tools', __end__: 'synthesize' })
    .addEdge('tools', 'research')
    .addEdge('synthesize', END)
    .compile()

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const { messages, planningDepth = 'detailed' } = state

    const latestHumanMessage = [...messages].reverse().find(m => m.type === 'human')
    if (!latestHumanMessage) {
      return { plan: null }
    }

    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId)

    try {
      const userContent =
        typeof latestHumanMessage.content === 'string'
          ? latestHumanMessage.content
          : JSON.stringify(latestHumanMessage.content)

      const systemMessage = messages.find(m => m.type === 'system')
      const projectContext = systemMessage
        ? typeof systemMessage.content === 'string'
          ? systemMessage.content
          : JSON.stringify(systemMessage.content)
        : null

      const initialMessages = [
        new SystemMessage(RESEARCH_SYSTEM_PROMPT),
        ...(projectContext ? [new HumanMessage(`Project context:\n\n${projectContext}`)] : []),
        new HumanMessage(userContent),
      ]

      const result = await subgraph.invoke(
        { messages: initialMessages, planningDepth },
        { ...config, callbacks: [handler] }
      )

      const lastMessage = result.messages[result.messages.length - 1]
      const plan = typeof lastMessage.content === 'string' ? lastMessage.content.trim() : null

      const modelName = model.getName() as string | undefined
      const reasoning = lastMessage.additional_kwargs?.reasoning_content?.toString() ?? undefined

      if (handler.traceId && plan) {
        langfuse.trace({ id: handler.traceId }).update({
          output: { plan },
          metadata: {
            ...(modelName && { model: modelName }),
            ...(reasoning && { reasoning }),
          },
        })
      }

      return { plan: plan || null }
    } catch {
      return { plan: null }
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/api/`:

```bash
npx tsc --noEmit
```

Expected: no errors in `src/graphs/planner-subgraph.ts`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/graphs/planner-subgraph.ts
git commit -m "feat: add planner ReAct subgraph with codebase exploration"
```

---

## Task 2: Create critic subgraph

**Files:**

- Create: `apps/api/src/graphs/critic-subgraph.ts`

### How it works

Same ReAct shape as the planner subgraph. The research phase receives the full conversation history and is instructed to read each file that was written (identified from `file_write` tool results in the history). The synthesize step uses `model.withStructuredOutput` to produce `{ approved, feedback }`.

`shouldRetry` moves here from `src/nodes/critic.ts`.

- [ ] **Step 1: Write `src/graphs/critic-subgraph.ts`**

```typescript
import { z } from 'zod'
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const criticOutputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
})

const RESEARCH_SYSTEM_PROMPT = `You are verifying whether a coding assistant completed a task correctly. Your job:
1. Look through the conversation for file_write tool results — those tell you which files were modified.
2. Use file_read to read each modified file.
3. Check that the content is correct and matches what the task required.
4. Read any related files (imports, configs, tests) if needed to verify correctness.

When you have read enough to make a verdict, stop making tool calls.`

const SYNTHESIZE_SYSTEM_PROMPT = (
  plan: string | null
) => `You are a code review critic. You have just read the relevant files. Now evaluate whether the task was fully completed.

CRITICAL: Base your verdict on what you read, not on prose claims in the conversation. "I've updated the file" is not evidence — the file content you just read is.

${
  plan
    ? `The assistant was following this plan:\n${plan}\n\nFor every plan step that requires a file change, confirm the file you read contains that change. If any step's change is missing, reject and name the missing step.`
    : ''
}

Reject if:
- Any required file change is missing from the files you read
- The assistant told the user to do something themselves instead of doing it
- There are obvious bugs in generated code

Approve if every required change is present in the files you read.`

const CriticSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  plan: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
})

type CriticSubgraphState = typeof CriticSubgraphState.State

export function createCriticNode(model: BaseChatModel, readOnlyTools: StructuredToolInterface[]) {
  const researchModel = model.bindTools(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools, { handleToolErrors: true })
  const structuredModel = model.withStructuredOutput(criticOutputSchema, { includeRaw: true })

  const researchNode = async (state: CriticSubgraphState) => {
    const response = await researchModel.invoke(state.messages)
    return { messages: [response] }
  }

  const synthesizeNode = async (state: CriticSubgraphState) => {
    const response = await structuredModel.invoke([
      new SystemMessage(SYNTHESIZE_SYSTEM_PROMPT(state.plan)),
      ...state.messages,
    ])
    // Store serialized result in last message for extraction by parent
    const { raw } = response as { raw: any; parsed: { approved: boolean; feedback: string } }
    return { messages: [raw] }
  }

  const subgraph = new StateGraph(CriticSubgraphState)
    .addNode('research', researchNode)
    .addNode('tools', toolNode)
    .addNode('synthesize', synthesizeNode)
    .addEdge(START, 'research')
    .addConditionalEdges('research', toolsCondition, { tools: 'tools', __end__: 'synthesize' })
    .addEdge('tools', 'research')
    .addEdge('synthesize', END)
    .compile()

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueAttempts } = state

    const conversationMessages = messages.filter(m => m.type !== 'system')
    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId)

    try {
      const initialMessages = [
        new SystemMessage(RESEARCH_SYSTEM_PROMPT),
        ...conversationMessages,
        new HumanMessage('Now read the files that were written and verify the task is complete.'),
      ]

      const result = await subgraph.invoke(
        { messages: initialMessages, plan },
        { ...config, callbacks: [handler] }
      )

      // Extract structured output: synthesize node stored the raw AI message
      const lastMessage = result.messages[result.messages.length - 1]
      const parsed = criticOutputSchema.parse(
        typeof lastMessage.content === 'string'
          ? JSON.parse(lastMessage.content)
          : lastMessage.content
      )

      const nextAttempts = critiqueAttempts + 1
      const nextFeedback = parsed.approved ? null : parsed.feedback
      const willRetry = nextFeedback !== null && nextAttempts <= 2

      const modelName = model.getName() as string | undefined
      const reasoning = lastMessage.additional_kwargs?.reasoning_content?.toString() ?? undefined

      if (handler.traceId) {
        langfuse.trace({ id: handler.traceId }).update({
          metadata: {
            approved: parsed.approved,
            critiqueFeedback: nextFeedback,
            critiqueAttempts: nextAttempts,
            willRetry,
            ...(modelName && { model: modelName }),
            ...(reasoning && { reasoning }),
          },
        })
      }

      return {
        critiqueAttempts: nextAttempts,
        critiqueFeedback: nextFeedback,
      }
    } catch {
      // On error, approve to avoid hanging the graph
      return {
        critiqueAttempts: critiqueAttempts + 1,
        critiqueFeedback: null,
      }
    }
  }
}

export function shouldRetry(state: AgentState): 'executor' | '__end__' {
  if (state.critiqueFeedback !== null && state.critiqueAttempts <= 2) {
    return 'executor'
  }
  return '__end__'
}
```

> **Note on structured output extraction:** `withStructuredOutput(..., { includeRaw: true })` returns `{ raw, parsed }` directly from `invoke`, not via messages. The `synthesizeNode` approach above stores only the raw AI message. The parent extracts the parsed content from the message content. If this is brittle with your LM Studio models, an alternative is to not use `withStructuredOutput` in the subgraph and instead call `structuredModel.invoke` directly in the parent node (outside the subgraph), passing it the subgraph research messages. See Task 2 Step 3.

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/api/`:

```bash
npx tsc --noEmit
```

Expected: no errors in `src/graphs/critic-subgraph.ts`

- [ ] **Step 3: (If structured output extraction is brittle) Refactor synthesize step**

If the approach of storing raw AI message in the subgraph and parsing it in the parent is fragile with LM Studio, use this alternative: remove the `synthesizeNode` from the subgraph entirely, and call `structuredModel.invoke` directly in the parent node after the subgraph returns:

```typescript
// In the parent node function, after subgraph.invoke:
const researchMessages = result.messages

const { parsed } = (await structuredModel.invoke(
  [new SystemMessage(SYNTHESIZE_SYSTEM_PROMPT(plan)), ...researchMessages],
  { callbacks: [handler] }
)) as { raw: any; parsed: { approved: boolean; feedback: string } }
```

And simplify the subgraph to only have `research` and `tools` nodes, ending when research emits no tool calls.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/graphs/critic-subgraph.ts
git commit -m "feat: add critic ReAct subgraph with file verification"
```

---

## Task 3: Wire subgraphs into agent.ts

**Files:**

- Modify: `apps/api/src/graphs/agent.ts`

- [ ] **Step 1: Update imports and wiring in `agent.ts`**

Replace the top of the file:

```typescript
// Remove these imports:
import { createPlannerNode } from '@/nodes/planner'
import { createCriticNode, shouldRetry } from '@/nodes/critic'

// Add these imports:
import { createPlannerNode } from '@/graphs/planner-subgraph'
import { createCriticNode, shouldRetry } from '@/graphs/critic-subgraph'
```

Extract read-only tools before the node factories, inside `createAgent()`:

```typescript
export async function createAgent() {
  const readOnlyTools = [fileSearchTool, fileReadTool]

  const tools = [...readOnlyTools, fileWriteTool, shellTool, ...(await client.getTools())]

  // ... models unchanged ...

  const plannerNode = createPlannerNode(reasoningModel, readOnlyTools)
  const criticNode = createCriticNode(reasoningModel, readOnlyTools)

  // ... rest unchanged ...
}
```

The full updated `agent.ts`:

```typescript
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { ChatOpenAIWithReasoning } from '@/utils/chat-openai-with-reasoning'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { env } from '@/env'
import { titleGeneratorNode } from '@/nodes/title-generator'
import { createClassifierNode } from '@/nodes/classifier'
import { createPlannerNode } from '@/graphs/planner-subgraph'
import { createExecutorNode } from '@/nodes/executor'
import { createCriticNode, shouldRetry } from '@/graphs/critic-subgraph'
import { systemPromptNode } from '@/nodes/system-prompt'

const client = new MultiServerMCPClient({
  context7: {
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
  },
})

export const agentStateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
  complexity: Annotation<'simple' | 'medium' | 'complex'>({
    reducer: (_, next) => next,
    default: () => 'medium' as const,
  }),
  planningDepth: Annotation<'brief' | 'detailed' | 'decomposed'>({
    reducer: (_, next) => next,
    default: () => 'detailed' as const,
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
})

export type AgentState = typeof agentStateSchema.State

export async function createAgent() {
  const readOnlyTools = [fileSearchTool, fileReadTool]

  const tools = [...readOnlyTools, fileWriteTool, shellTool, ...(await client.getTools())]

  const reasoningModel = new ChatOpenAIWithReasoning({
    model: env.REASONING_MODEL,
    configuration: { baseURL: env.LM_STUDIO_API_URL },
    apiKey: 'lm-studio',
    temperature: 0,
    streaming: true,
  })

  const codingModel = new ChatOpenAIWithReasoning({
    model: env.CODING_MODEL,
    configuration: { baseURL: env.LM_STUDIO_API_URL },
    apiKey: 'lm-studio',
    temperature: 0.3,
    streaming: true,
  })

  const codingModelWithTools = codingModel.bindTools(tools)

  const toolNode = new ToolNode(tools, { handleToolErrors: true })

  const classifierNode = createClassifierNode(reasoningModel)
  const plannerNode = createPlannerNode(reasoningModel, readOnlyTools)
  const executorNode = createExecutorNode(codingModelWithTools, env.CODING_MODEL)
  const criticNode = createCriticNode(reasoningModel, readOnlyTools)

  const workflow = new StateGraph(agentStateSchema)
    .addNode('title-generator', titleGeneratorNode)
    .addNode('system-prompt', systemPromptNode)
    .addNode('classifier', classifierNode)
    .addNode('planner', plannerNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addNode('critic', criticNode)
    .addEdge(START, 'title-generator')
    .addEdge('title-generator', 'system-prompt')
    .addEdge('system-prompt', 'classifier')
    .addConditionalEdges(
      'classifier',
      (state: AgentState) => (state.complexity === 'simple' ? 'executor' : 'planner'),
      { executor: 'executor', planner: 'planner' }
    )
    .addEdge('planner', 'executor')
    .addConditionalEdges('executor', toolsCondition, { tools: 'tools', __end__: 'critic' })
    .addEdge('tools', 'executor')
    .addConditionalEdges('critic', shouldRetry, { executor: 'executor', __end__: END })

  return workflow.compile()
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `apps/api/`:

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/graphs/agent.ts
git commit -m "feat: wire planner and critic subgraphs into agent graph"
```

---

## Task 4: Delete old node files

**Files:**

- Delete: `apps/api/src/nodes/planner.ts`
- Delete: `apps/api/src/nodes/critic.ts`

- [ ] **Step 1: Delete the old files**

```bash
rm apps/api/src/nodes/planner.ts
rm apps/api/src/nodes/critic.ts
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -r "nodes/planner\|nodes/critic" apps/api/src/
```

Expected: no output

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old planner and critic node files"
```

---

## Known Friction Points

**Structured output in subgraph (Task 2):** `withStructuredOutput` wraps the model and returns `{ raw, parsed }` from `invoke`. Inside a `StateGraph` node, the node must return `{ messages: [...] }`. The plan stores `raw` in messages and parses it in the parent. If your LM Studio model returns structured output in an unexpected format, use the refactor in Task 2 Step 3 — call `structuredModel` directly in the parent after the subgraph finishes, outside the subgraph.

**Config propagation (all tasks):** `file_read` and `file_search` require `config.configurable.project_path`. This is passed by spreading the parent config into `subgraph.invoke(..., { ...config, callbacks: [handler] })`. If tools fail with "project_path undefined", verify the parent config includes `configurable.project_path`.
