# Langfuse Session Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session observability to the LangGraph agent using Langfuse — automatic LLM call tracing via CallbackHandler plus targeted metadata annotations in classifier, planner, and critic nodes.

**Architecture:** Langfuse self-hosted (already running). A singleton Langfuse client and `createCallbackHandler(sessionId)` utility live in `apps/api/src/utils/langfuse.ts`. Each model-invoking node creates a `CallbackHandler` using the LangGraph `thread_id` as `sessionId` and passes it to `model.invoke()`. Three nodes (classifier, planner, critic) additionally annotate the auto-created trace with agent-specific state after the LLM call.

**Tech Stack:** `langfuse` (Node.js SDK), `langfuse-langchain` (CallbackHandler), LangGraph JS, LangChain Core, Vitest

---

## File Map

| Action | Path                                  | Responsibility                                                    |
| ------ | ------------------------------------- | ----------------------------------------------------------------- |
| Create | `apps/api/src/utils/langfuse.ts`      | Singleton client + `createCallbackHandler` factory                |
| Modify | `apps/api/src/env.ts`                 | Add `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` |
| Modify | `apps/api/.env`                       | Add actual Langfuse env var values                                |
| Modify | `apps/api/src/nodes/classifier.ts`    | Accept `RunnableConfig`, pass callbacks, annotate trace           |
| Modify | `apps/api/src/nodes/planner.ts`       | Accept `RunnableConfig`, pass callbacks, annotate trace           |
| Modify | `apps/api/src/nodes/executor.ts`      | Pass callbacks to `modelWithTools.invoke`                         |
| Modify | `apps/api/src/nodes/critic.ts`        | Accept `RunnableConfig`, pass callbacks, annotate trace           |
| Create | `apps/api/src/utils/langfuse.test.ts` | Unit tests for the utility                                        |

---

## Task 1: Install packages and add env vars

**Files:**

- Modify: `apps/api/package.json` (via pnpm)
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/.env`

- [ ] **Step 1: Install packages**

```bash
cd apps/api && pnpm add langfuse langfuse-langchain
```

Expected: packages added to `apps/api/package.json` dependencies.

- [ ] **Step 2: Add env vars to `apps/api/.env`**

Add these three lines to `apps/api/.env`:

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=http://localhost:3000
```

Replace `pk-lf-...` and `sk-lf-...` with the actual keys from your Langfuse self-hosted instance (Settings → API Keys in the Langfuse UI). Adjust the port if your Langfuse runs on a different one.

- [ ] **Step 3: Update `apps/api/src/env.ts`**

Replace the entire file with:

```ts
import z from 'zod'

const envSchema = z.object({
  REASONING_MODEL: z.string(),
  CODING_MODEL: z.string(),
  LM_STUDIO_API_URL: z.url(),
  SUMMARIZATION_MODEL: z.string(),
  LANGGRAPH_API_URL: z.url(),
  DATABASE_URL: z.url(),
  LANGFUSE_PUBLIC_KEY: z.string(),
  LANGFUSE_SECRET_KEY: z.string(),
  LANGFUSE_HOST: z.url(),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && pnpx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/pnpm-lock.yaml apps/api/src/env.ts
git commit -m "feat: install langfuse packages and add env vars"
```

---

## Task 2: Create the Langfuse utility

**Files:**

- Create: `apps/api/src/utils/langfuse.ts`
- Create: `apps/api/src/utils/langfuse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/utils/langfuse.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/env', () => ({
  env: {
    LANGFUSE_PUBLIC_KEY: 'pk-test',
    LANGFUSE_SECRET_KEY: 'sk-test',
    LANGFUSE_HOST: 'http://localhost:3000',
  },
}))

describe('createCallbackHandler', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a CallbackHandler instance', async () => {
    const { createCallbackHandler } = await import('@/utils/langfuse')
    const { CallbackHandler } = await import('langfuse-langchain')
    const handler = createCallbackHandler('thread-123')
    expect(handler).toBeInstanceOf(CallbackHandler)
  })

  it('uses the provided sessionId', async () => {
    const { createCallbackHandler } = await import('@/utils/langfuse')
    const handler = createCallbackHandler('thread-abc')
    expect((handler as any).sessionId).toBe('thread-abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm test src/utils/langfuse.test.ts
```

Expected: FAIL — module `@/utils/langfuse` not found.

- [ ] **Step 3: Create `apps/api/src/utils/langfuse.ts`**

```ts
import { Langfuse } from 'langfuse'
import { CallbackHandler } from 'langfuse-langchain'
import { env } from '@/env'

export const langfuse = new Langfuse({
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_HOST,
})

process.on('beforeExit', async () => {
  await langfuse.flushAsync()
})

export function createCallbackHandler(sessionId: string): CallbackHandler {
  return new CallbackHandler({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_HOST,
    sessionId,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && pnpm test src/utils/langfuse.test.ts
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/langfuse.ts apps/api/src/utils/langfuse.test.ts
git commit -m "feat: add langfuse client utility"
```

---

## Task 3: Instrument the classifier node

**Files:**

- Modify: `apps/api/src/nodes/classifier.ts`

The classifier currently has signature `async (state: AgentState)`. We add `config: RunnableConfig` as the second parameter to access `thread_id`, pass the callback handler to the model invocation, and annotate the auto-created trace with `complexity` and `planningDepth` after the call.

- [ ] **Step 1: Replace `apps/api/src/nodes/classifier.ts`**

```ts
import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const classifierOutputSchema = z.object({
  complexity: z.enum(['simple', 'medium', 'complex']),
  planningDepth: z.enum(['brief', 'detailed', 'decomposed']),
})

const CLASSIFIER_SYSTEM_PROMPT = `You are a task classifier for a coding assistant. Given a user's coding request, classify its complexity and determine the appropriate planning depth.

Complexity levels:
- simple: explain code, answer questions, read and summarize files (most tasks)
- medium: debug issues, make targeted changes to one or a few related files
- complex: implement new features, refactor across multiple files, architectural changes

Planning depth mirrors complexity:
- brief (for simple): 2-3 steps — which files to read, what to answer
- detailed (for medium): numbered steps — files to inspect, changes to make, order of operations
- decomposed (for complex): sub-tasks with dependencies spelled out

Return only the classification. Do not explain.`

export function createClassifierNode(model: BaseChatModel) {
  const structuredClassifier = model.withStructuredOutput(classifierOutputSchema)

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const firstHumanMessage = state.messages.find(
      m => m.getType() === 'human' || (m as any)._getType?.() === 'human'
    )

    if (!firstHumanMessage) {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }

    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId ?? 'unknown')

    try {
      const userContent =
        typeof firstHumanMessage.content === 'string'
          ? firstHumanMessage.content
          : JSON.stringify(firstHumanMessage.content)

      const result = (await structuredClassifier.invoke(
        [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        { callbacks: [handler] }
      )) as {
        complexity: 'simple' | 'medium' | 'complex'
        planningDepth: 'brief' | 'detailed' | 'decomposed'
      }

      if (handler.traceId) {
        langfuse.trace({ id: handler.traceId }).update({
          metadata: {
            complexity: result.complexity,
            planningDepth: result.planningDepth,
          },
        })
      }

      return result
    } catch {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && pnpx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/nodes/classifier.ts
git commit -m "feat: add langfuse tracing to classifier node"
```

---

## Task 4: Instrument the planner node

**Files:**

- Modify: `apps/api/src/nodes/planner.ts`

The planner logs the generated plan string as trace output metadata.

- [ ] **Step 1: Replace `apps/api/src/nodes/planner.ts`**

```ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const DEPTH_INSTRUCTIONS: Record<'brief' | 'detailed' | 'decomposed', string> = {
  brief: `Create a brief 2-3 step plan. Identify which files need to be read and what needs to be answered. Keep it concise.`,
  detailed: `Create a detailed numbered plan. List: files to inspect first, specific changes to make, and the order of operations. Include any dependencies between steps.`,
  decomposed: `Break this into sub-tasks with dependencies. For each sub-task: what it does, which files it touches, and what must be completed before it can start. Number the sub-tasks and mark dependencies explicitly.`,
}

const PLANNER_SYSTEM_PROMPT = (depth: 'brief' | 'detailed' | 'decomposed') =>
  `You are a planning assistant for a coding agent. Create a clear, actionable plan that a coding agent will follow to complete the task.

${DEPTH_INSTRUCTIONS[depth]}

Output ONLY the plan as markdown. No preamble, no explanation. The plan will be injected into the coding agent's context.`

export function createPlannerNode(model: BaseChatModel) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const { messages, planningDepth = 'detailed' } = state

    const latestHumanMessage = [...messages]
      .reverse()
      .find(m => m.getType() === 'human' || (m as any)._getType?.() === 'human')

    if (!latestHumanMessage) {
      return { plan: null }
    }

    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId ?? 'unknown')

    try {
      const userContent =
        typeof latestHumanMessage.content === 'string'
          ? latestHumanMessage.content
          : JSON.stringify(latestHumanMessage.content)

      const response = await model.invoke(
        [new SystemMessage(PLANNER_SYSTEM_PROMPT(planningDepth)), new HumanMessage(userContent)],
        { callbacks: [handler] }
      )

      const plan = typeof response.content === 'string' ? response.content.trim() : null

      if (handler.traceId && plan) {
        langfuse.trace({ id: handler.traceId }).update({
          output: { plan },
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

```bash
cd apps/api && pnpx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/nodes/planner.ts
git commit -m "feat: add langfuse tracing to planner node"
```

---

## Task 5: Instrument the executor node

**Files:**

- Modify: `apps/api/src/nodes/executor.ts`

The executor already receives `runtime: Runtime` as its second argument. `runtime.configurable?.thread_id` gives us the thread ID. No manual metadata annotation needed — the CallbackHandler automatically captures tool calls and LLM responses.

- [ ] **Step 1: Replace `apps/api/src/nodes/executor.ts`**

```ts
import { SystemMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import type { BaseMessage, Runtime } from 'langchain'
import type { AgentState } from '@/graphs/agent'
import { fileReadTool } from '@/tools/file-read'
import { createCallbackHandler } from '@/utils/langfuse'

const BASE_SYSTEM_PROMPT = `You are an AI developer assistant that helps users with coding tasks.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root (e.g., "src/agent/tools/file-read.ts", NOT absolute paths like "/Users/..."). Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- For searching files by NAME or PATH (e.g., "read auth.ts", "describe package.json", etc.), use the file_search tool to find the file.
- For searching file CONTENTS, use the shell tool with grep or ripgrep.

**External Libraries and Documentation:**
- If the user's question or task involves an external library, package, or framework (e.g. "what are the X classes in tailwind", "how do I use Y in react", "show me Z from lodash"), your FIRST tool call MUST be to Context7 to fetch the documentation. Do NOT search the project files first. Do NOT use your training knowledge. Call Context7 immediately as the very first action.

**Reasoning and Tool Usage:**
- Think step-by-step about what information you need before making tool calls
- Use tools strategically - gather necessary context first, then take action
- When you have enough information to answer the user's question, provide a clear and helpful response
- If a tool call fails, reason about why it failed and try a different approach
`

const AGENTS_MD_PROMPT = `
${BASE_SYSTEM_PROMPT}\n\n
Use the following project-specific instructions to guide your actions:

{{agentsMd}}
`

type AgentContext = {
  project_path: string
}

const isAgentContext = (context: unknown): context is AgentContext => {
  return typeof context === 'object' && context !== null && 'project_path' in context
}

function buildSystemPromptContent(
  base: string,
  plan: string | null,
  critiqueFeedback: string | null
): string {
  let content = base

  if (plan) {
    content += `\n\n## Your Plan\n\nFollow this plan to complete the task:\n\n${plan}`
  }

  if (critiqueFeedback) {
    content += `\n\n## Previous Attempt Feedback\n\nA previous attempt was reviewed and found these issues. Fix them:\n\n${critiqueFeedback}`
  }

  return content
}

async function buildSystemPrompt(
  _messages: Array<BaseMessage>,
  runtime: Runtime,
  plan: string | null,
  critiqueFeedback: string | null
): Promise<BaseMessage> {
  if (isAgentContext(runtime.context)) {
    try {
      const agentsMd = await fileReadTool.invoke(
        { path: 'AGENTS.md' },
        { context: { project_path: runtime.context.project_path } }
      )
      const base = AGENTS_MD_PROMPT.replace('{{agentsMd}}', agentsMd)
      return new SystemMessage(buildSystemPromptContent(base, plan, critiqueFeedback))
    } catch {
      // AGENTS.md not found, fall through to base prompt
    }
  }

  return new SystemMessage(buildSystemPromptContent(BASE_SYSTEM_PROMPT, plan, critiqueFeedback))
}

export function createExecutorNode(modelWithTools: Runnable<Array<BaseMessage>>) {
  return async (state: AgentState, runtime: Runtime): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueFeedback } = state

    const threadId = (runtime as any).configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId ?? 'unknown')

    const hasSystemMessage = messages.some(
      (msg): msg is SystemMessage => msg instanceof SystemMessage
    )

    const messagesWithSystem = hasSystemMessage
      ? messages
      : [await buildSystemPrompt(messages, runtime, plan, critiqueFeedback), ...messages]

    const response = await modelWithTools.invoke(messagesWithSystem, { callbacks: [handler] })

    return { messages: [response] }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && pnpx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/nodes/executor.ts
git commit -m "feat: add langfuse tracing to executor node"
```

---

## Task 6: Instrument the critic node

**Files:**

- Modify: `apps/api/src/nodes/critic.ts`

The critic logs `critiqueFeedback`, `critiqueAttempts`, and the retry decision — the most important debugging metadata in the whole graph.

- [ ] **Step 1: Replace `apps/api/src/nodes/critic.ts`**

```ts
import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const criticOutputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
})

const CRITIC_SYSTEM_PROMPT = (
  plan: string | null
) => `You are a code review critic evaluating whether a coding assistant fully completed the user's request.

Be practical. Approve if:
- The task is complete even if not perfect
- The approach is sound and accomplishes the goal
- Any code changes are syntactically correct and logically sound

Reject only if:
- The task is clearly incomplete (files mentioned but not changed, steps skipped)
- There are obvious bugs in generated code
- The response doesn't address the actual request

${plan ? `The assistant was following this plan:\n${plan}\n\n` : ''}Return your assessment as structured output.`

export function createCriticNode(model: BaseChatModel) {
  const structuredCritic = model.withStructuredOutput(criticOutputSchema)

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueAttempts } = state

    const humanMessages = messages.filter(m => m.getType() === 'human')
    const aiMessages = messages.filter(m => m.getType() === 'ai')

    const latestUserRequest = humanMessages.at(-1)
    const latestResponse = aiMessages.at(-1)

    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId ?? 'unknown')

    try {
      const userContent =
        typeof latestUserRequest?.content === 'string'
          ? latestUserRequest.content
          : JSON.stringify(latestUserRequest?.content)

      const assistantContent =
        typeof latestResponse?.content === 'string'
          ? latestResponse.content
          : JSON.stringify(latestResponse?.content)

      const result = (await structuredCritic.invoke(
        [
          { role: 'system', content: CRITIC_SYSTEM_PROMPT(plan) },
          {
            role: 'user',
            content: `User request:\n${userContent}\n\nAssistant response:\n${assistantContent}`,
          },
        ],
        { callbacks: [handler] }
      )) as { approved: boolean; feedback: string }

      const nextAttempts = critiqueAttempts + 1
      const nextFeedback = result.approved ? null : result.feedback
      const willRetry = nextFeedback !== null && nextAttempts <= 2

      if (handler.traceId) {
        langfuse.trace({ id: handler.traceId }).update({
          metadata: {
            approved: result.approved,
            critiqueFeedback: nextFeedback,
            critiqueAttempts: nextAttempts,
            willRetry,
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && pnpx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/nodes/critic.ts
git commit -m "feat: add langfuse tracing to critic node"
```

---

## Task 7: Run all tests and verify

- [ ] **Step 1: Run the full test suite**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass including the new `langfuse.test.ts`.

- [ ] **Step 2: Smoke test against running Langfuse**

Start the dev server and send a request:

```bash
cd apps/api && pnpm dev
```

Then send a message via the web UI. Open Langfuse at `http://localhost:3000` (or your configured port) and confirm:

- A new session appears under Sessions, keyed by the LangGraph `thread_id`
- Traces show node spans (classifier, planner if non-simple, executor, critic)
- Each trace has LLM generation spans with token counts and latency
- The classifier trace has `complexity` and `planningDepth` in metadata
- The critic trace has `approved`, `critiqueFeedback`, `critiqueAttempts`, `willRetry` in metadata

- [ ] **Step 3: Commit test file**

```bash
git add apps/api/src/utils/langfuse.test.ts
git commit -m "test: add unit tests for langfuse utility"
```
