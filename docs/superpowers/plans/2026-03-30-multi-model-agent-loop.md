# Multi-Model Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-model ReAct loop with a four-phase pipeline (router → planner → executor → critic) where the reasoning model (Qwen3-30B via LM Studio) handles planning and critique, and the coding model (Qwen3-Coder-30B) handles execution.

**Architecture:** A LangGraph `StateGraph` with new state fields for `complexity`, `planningDepth`, `plan`, `critiqueAttempts`, and `critiqueFeedback`. Each phase is a factory-created node receiving its model as a parameter (for testability). The critic's conditional edge routes back to the executor on failure, capped at 2 retries. Both reasoning and coding models are served via LM Studio's OpenAI-compatible API using `ChatOpenAI` from `@langchain/openai`.

**Tech Stack:** LangGraph, `@langchain/openai` (new), `@langchain/core`, Zod v4, Vitest (new for api package), TypeScript ESM.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `apps/api/package.json` | Add `@langchain/openai`, `vitest` |
| Create | `apps/api/vitest.config.ts` | Vitest config for ESM + path aliases |
| Modify | `apps/api/src/env.ts` | Replace `AGENT_MODEL` with `REASONING_MODEL`, `CODING_MODEL`, `LM_STUDIO_API_URL` |
| Modify | `apps/api/src/graphs/agent.ts` | New state schema (exported), new graph wiring |
| Create | `apps/api/src/nodes/router.ts` | Classify task complexity, set planning depth |
| Create | `apps/api/src/nodes/planner.ts` | Generate plan calibrated to depth |
| Rename + Modify | `apps/api/src/nodes/llm.ts` → `executor.ts` | Switch to ChatOpenAI, inject plan + critique feedback |
| Create | `apps/api/src/nodes/critic.ts` | Review executor output, approve or send back with feedback |
| Create | `apps/api/src/nodes/__tests__/router.test.ts` | Unit tests for router node |
| Create | `apps/api/src/nodes/__tests__/planner.test.ts` | Unit tests for planner node |
| Create | `apps/api/src/nodes/__tests__/executor.test.ts` | Unit tests for executor node |
| Create | `apps/api/src/nodes/__tests__/critic.test.ts` | Unit tests for critic node + shouldRetry |
| Unchanged | `apps/api/src/nodes/title-generator.ts` | No changes |
| Unchanged | `apps/api/src/tools/*` | No changes |

---

## Task 1: Install dependencies and configure Vitest

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/vitest.config.ts`
- Modify: `apps/api/tsconfig.json` (if it exists; otherwise skip)

- [ ] **Step 1: Add dependencies**

In `apps/api/package.json`, add to `dependencies`:
```json
"@langchain/openai": "^0.5.0"
```
Add to `devDependencies`:
```json
"vitest": "^3.0.0"
```

- [ ] **Step 2: Install**

```bash
cd apps/api && pnpm install
```

Expected: packages install without errors.

- [ ] **Step 3: Check for existing tsconfig in api**

```bash
ls apps/api/tsconfig.json
```

If it exists, read it. If not, skip to step 5.

- [ ] **Step 4: Verify path alias `@/*` is configured**

The tsconfig should have a `paths` entry mapping `@/*` to `./src/*`. If it does, vitest needs the same mapping. If the tsconfig has no paths, skip step 5.

- [ ] **Step 5: Create vitest config**

Create `apps/api/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 6: Add test script to api package.json**

In `apps/api/package.json`, add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Verify vitest runs**

```bash
cd apps/api && pnpm test
```

Expected: `No test files found` (not an error — just no tests yet).

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(api): add @langchain/openai and vitest"
```

---

## Task 2: Update environment variables

**Files:**
- Modify: `apps/api/src/env.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/nodes/__tests__/env.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('env schema', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  it('parses valid env with new model vars', async () => {
    process.env.REASONING_MODEL = 'qwen3-30b'
    process.env.CODING_MODEL = 'qwen3-coder-30b'
    process.env.LM_STUDIO_API_URL = 'http://localhost:1234/v1'
    process.env.RAG_MODEL = 'nomic-embed-text'
    process.env.SUMMARIZATION_MODEL = 'qwen3-30b'
    process.env.OLLAMA_API_URL = 'http://localhost:11434'
    process.env.LANGGRAPH_API_URL = 'http://localhost:2024'
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'

    const { env } = await import('@/env')
    expect(env.REASONING_MODEL).toBe('qwen3-30b')
    expect(env.CODING_MODEL).toBe('qwen3-coder-30b')
    expect(env.LM_STUDIO_API_URL).toBe('http://localhost:1234/v1')
  })

  it('throws when REASONING_MODEL is missing', async () => {
    process.env.CODING_MODEL = 'qwen3-coder-30b'
    process.env.LM_STUDIO_API_URL = 'http://localhost:1234/v1'
    // REASONING_MODEL intentionally missing
    expect(() => import('@/env')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Update env.ts**

Replace `apps/api/src/env.ts` with:
```typescript
import z from 'zod'

const envSchema = z.object({
  REASONING_MODEL: z.string(),
  CODING_MODEL: z.string(),
  LM_STUDIO_API_URL: z.url(),
  RAG_MODEL: z.string(),
  SUMMARIZATION_MODEL: z.string(),
  OLLAMA_API_URL: z.url(),
  LANGGRAPH_API_URL: z.url(),
  DATABASE_URL: z.url(),
})

export const env = envSchema.parse(process.env)
```

- [ ] **Step 3: Update your `.env` file**

Add the new vars and remove `AGENT_MODEL`:
```
REASONING_MODEL=qwen3-30b
CODING_MODEL=qwen3-coder-30b
LM_STUDIO_API_URL=http://localhost:1234/v1
# Remove: AGENT_MODEL=...
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/env.ts
git commit -m "feat(api): replace AGENT_MODEL with REASONING_MODEL, CODING_MODEL, LM_STUDIO_API_URL"
```

---

## Task 3: Export state schema from agent.ts

The state schema is currently local to `createAgent()`. Nodes need the `AgentState` type. Lift it to module scope and export it.

**Files:**
- Modify: `apps/api/src/graphs/agent.ts`

- [ ] **Step 1: Lift the state schema**

In `apps/api/src/graphs/agent.ts`, replace the current state definition inside `createAgent()`:
```typescript
// BEFORE (inside createAgent):
const stateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
})
```

With a module-level export (before the `createAgent` function):
```typescript
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
```

And update `createAgent()` to reference `agentStateSchema` instead of `stateSchema`.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/graphs/agent.ts
git commit -m "feat(api): export agentStateSchema and AgentState type with new state fields"
```

---

## Task 4: Implement the router node

The router classifies the user's request and sets `complexity` and `planningDepth` in state. It uses a factory pattern so tests can inject a mock model.

**Files:**
- Create: `apps/api/src/nodes/router.ts`
- Create: `apps/api/src/nodes/__tests__/router.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/nodes/__tests__/router.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { createRouterNode } from '@/nodes/router'

const makeModel = (output: { complexity: string; planningDepth: string }) => ({
  withStructuredOutput: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(output),
  }),
})

describe('createRouterNode', () => {
  it('returns complexity and planningDepth from model output', async () => {
    const model = makeModel({ complexity: 'simple', planningDepth: 'brief' })
    const node = createRouterNode(model as any)
    const result = await node({
      messages: [new HumanMessage('explain this function')],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.complexity).toBe('simple')
    expect(result.planningDepth).toBe('brief')
  })

  it('defaults to medium/detailed when no human message', async () => {
    const model = makeModel({ complexity: 'simple', planningDepth: 'brief' })
    const node = createRouterNode(model as any)
    const result = await node({
      messages: [],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.complexity).toBe('medium')
    expect(result.planningDepth).toBe('detailed')
  })

  it('defaults to medium/detailed when model throws', async () => {
    const model = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error('model error')),
      }),
    }
    const node = createRouterNode(model as any)
    const result = await node({
      messages: [new HumanMessage('refactor everything')],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.complexity).toBe('medium')
    expect(result.planningDepth).toBe('detailed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test
```

Expected: FAIL — `Cannot find module '@/nodes/router'`

- [ ] **Step 3: Implement router.ts**

Create `apps/api/src/nodes/router.ts`:
```typescript
import { z } from 'zod'
import type { AgentState } from '@/graphs/agent'

const routerOutputSchema = z.object({
  complexity: z.enum(['simple', 'medium', 'complex']),
  planningDepth: z.enum(['brief', 'detailed', 'decomposed']),
})

const ROUTER_SYSTEM_PROMPT = `You are a task classifier for a coding assistant. Given a user's coding request, classify its complexity and determine the appropriate planning depth.

Complexity levels:
- simple: explain code, answer questions, read and summarize files (most tasks)
- medium: debug issues, make targeted changes to one or a few related files
- complex: implement new features, refactor across multiple files, architectural changes

Planning depth mirrors complexity:
- brief (for simple): 2-3 steps — which files to read, what to answer
- detailed (for medium): numbered steps — files to inspect, changes to make, order of operations
- decomposed (for complex): sub-tasks with dependencies spelled out

Return only the classification. Do not explain.`

export function createRouterNode(model: { withStructuredOutput: (schema: unknown) => { invoke: (messages: unknown) => Promise<unknown> } }) {
  const structuredRouter = model.withStructuredOutput(routerOutputSchema)

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const firstHumanMessage = state.messages.find(
      m => m.getType?.() === 'human' || (m as any)._getType?.() === 'human'
    )

    if (!firstHumanMessage) {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }

    try {
      const userContent =
        typeof firstHumanMessage.content === 'string'
          ? firstHumanMessage.content
          : JSON.stringify(firstHumanMessage.content)

      const result = await structuredRouter.invoke([
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ])

      return result as { complexity: 'simple' | 'medium' | 'complex'; planningDepth: 'brief' | 'detailed' | 'decomposed' }
    } catch {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test
```

Expected: PASS — 3 passing tests in `router.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/nodes/router.ts apps/api/src/nodes/__tests__/router.test.ts
git commit -m "feat(api): add router node with complexity classification"
```

---

## Task 5: Implement the planner node

The planner generates a markdown plan calibrated to the `planningDepth` in state. It uses Qwen3's native thinking mode by appending `/think` to the user message.

**Files:**
- Create: `apps/api/src/nodes/planner.ts`
- Create: `apps/api/src/nodes/__tests__/planner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/nodes/__tests__/planner.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { createPlannerNode } from '@/nodes/planner'

const makeModel = (responseContent: string) => ({
  invoke: vi.fn().mockResolvedValue({ content: responseContent }),
})

describe('createPlannerNode', () => {
  it('returns plan string from model output', async () => {
    const model = makeModel('1. Read auth.ts\n2. Explain the logic')
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [new HumanMessage('explain the auth module')],
      complexity: 'simple',
      planningDepth: 'brief',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBe('1. Read auth.ts\n2. Explain the logic')
  })

  it('returns null plan when no human message', async () => {
    const model = makeModel('some plan')
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [],
      complexity: 'simple',
      planningDepth: 'brief',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBeNull()
  })

  it('returns null plan when model throws', async () => {
    const model = { invoke: vi.fn().mockRejectedValue(new Error('timeout')) }
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [new HumanMessage('refactor everything')],
      complexity: 'complex',
      planningDepth: 'decomposed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBeNull()
  })

  it('returns null when model returns empty content', async () => {
    const model = makeModel('   ')
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [new HumanMessage('do something')],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test
```

Expected: FAIL — `Cannot find module '@/nodes/planner'`

- [ ] **Step 3: Implement planner.ts**

Create `apps/api/src/nodes/planner.ts`:
```typescript
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'

const DEPTH_INSTRUCTIONS: Record<'brief' | 'detailed' | 'decomposed', string> = {
  brief: `Create a brief 2-3 step plan. Identify which files need to be read and what needs to be answered. Keep it concise.`,
  detailed: `Create a detailed numbered plan. List: files to inspect first, specific changes to make, and the order of operations. Include any dependencies between steps.`,
  decomposed: `Break this into sub-tasks with dependencies. For each sub-task: what it does, which files it touches, and what must be completed before it can start. Number the sub-tasks and mark dependencies explicitly.`,
}

const PLANNER_SYSTEM_PROMPT = (depth: 'brief' | 'detailed' | 'decomposed') =>
  `You are a planning assistant for a coding agent. Create a clear, actionable plan that a coding agent will follow to complete the task.

${DEPTH_INSTRUCTIONS[depth]}

Output ONLY the plan as markdown. No preamble, no explanation. The plan will be injected into the coding agent's context.`

export function createPlannerNode(model: { invoke: (messages: unknown) => Promise<{ content: unknown }> }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const { messages, planningDepth = 'detailed' } = state

    const humanMessages = messages.filter(
      m => m.getType?.() === 'human' || (m as any)._getType?.() === 'human'
    )
    const latestHumanMessage = humanMessages[humanMessages.length - 1]

    if (!latestHumanMessage) {
      return { plan: null }
    }

    try {
      const userContent =
        typeof latestHumanMessage.content === 'string'
          ? latestHumanMessage.content
          : JSON.stringify(latestHumanMessage.content)

      // Append /think to enable Qwen3's native thinking mode
      const userContentWithThink = `${userContent}\n\n/think`

      const response = await model.invoke([
        new SystemMessage(PLANNER_SYSTEM_PROMPT(planningDepth)),
        new HumanMessage(userContentWithThink),
      ])

      const plan = typeof response.content === 'string' ? response.content.trim() : null
      return { plan: plan || null }
    } catch {
      return { plan: null }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test
```

Expected: PASS — 4 passing tests in `planner.test.ts`, 3 in `router.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/nodes/planner.ts apps/api/src/nodes/__tests__/planner.test.ts
git commit -m "feat(api): add planner node with depth-calibrated planning"
```

---

## Task 6: Refactor llm.ts into executor.ts

Rename `llm.ts` to `executor.ts`. Switch the model to `ChatOpenAI` pointing at LM Studio. Inject `plan` and `critiqueFeedback` from state into the system prompt.

**Files:**
- Create: `apps/api/src/nodes/executor.ts` (replaces `llm.ts`)
- Create: `apps/api/src/nodes/__tests__/executor.test.ts`
- Delete: `apps/api/src/nodes/llm.ts` (after wiring is updated in Task 8)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/nodes/__tests__/executor.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { createExecutorNode } from '@/nodes/executor'

const makeModelWithTools = (responseContent: string) => ({
  invoke: vi.fn().mockResolvedValue(new AIMessage(responseContent)),
})

describe('createExecutorNode', () => {
  it('returns model response as messages update', async () => {
    const model = makeModelWithTools('Here is your answer')
    const node = createExecutorNode(model as any)
    const result = await node(
      {
        messages: [new HumanMessage('what does this do?')],
        complexity: 'simple',
        planningDepth: 'brief',
        plan: null,
        critiqueAttempts: 0,
        critiqueFeedback: null,
      },
      { context: { project_path: '/tmp/project' } } as any
    )
    expect(result.messages).toHaveLength(1)
    expect((result.messages![0] as AIMessage).content).toBe('Here is your answer')
  })

  it('includes plan in system prompt when plan is present', async () => {
    const model = makeModelWithTools('done')
    const node = createExecutorNode(model as any)
    await node(
      {
        messages: [new HumanMessage('fix the bug')],
        complexity: 'medium',
        planningDepth: 'detailed',
        plan: '1. Read buggy.ts\n2. Fix the off-by-one error',
        critiqueAttempts: 0,
        critiqueFeedback: null,
      },
      { context: { project_path: '/tmp/project' } } as any
    )
    const invokedMessages = model.invoke.mock.calls[0][0] as unknown[]
    const systemMsg = invokedMessages[0] as { content: string }
    expect(systemMsg.content).toContain('1. Read buggy.ts')
  })

  it('includes critique feedback in system prompt on retry', async () => {
    const model = makeModelWithTools('fixed')
    const node = createExecutorNode(model as any)
    await node(
      {
        messages: [new HumanMessage('fix the bug')],
        complexity: 'medium',
        planningDepth: 'detailed',
        plan: '1. Read buggy.ts',
        critiqueAttempts: 1,
        critiqueFeedback: 'You forgot to handle the null case in line 42',
      },
      { context: { project_path: '/tmp/project' } } as any
    )
    const invokedMessages = model.invoke.mock.calls[0][0] as unknown[]
    const systemMsg = invokedMessages[0] as { content: string }
    expect(systemMsg.content).toContain('null case in line 42')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test
```

Expected: FAIL — `Cannot find module '@/nodes/executor'`

- [ ] **Step 3: Create executor.ts**

Create `apps/api/src/nodes/executor.ts`:
```typescript
import { SystemMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import type { BaseMessage, Runtime } from 'langchain'
import { fileReadTool } from '@/tools/file-read'
import type { AgentState } from '@/graphs/agent'

const BASE_SYSTEM_PROMPT = `You are an AI developer assistant that helps users with coding tasks.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root (e.g., "src/agent/tools/file-read.ts", NOT absolute paths like "/Users/..."). Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- For searching files by NAME or PATH (e.g., "read auth.ts", "describe package.json", etc.), use the file_search tool to find the file.
- For semantic searches through file CONTENTS (e.g., "where is the authentication code?", "find database setup"), use the rag_file_search tool.

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
  messages: Array<BaseMessage>,
  runtime: Runtime,
  plan: string | null,
  critiqueFeedback: string | null
): Promise<BaseMessage> {
  if (isAgentContext(runtime.context)) {
    const agentsMd = await fileReadTool.invoke(
      { path: 'AGENTS.md' },
      { context: { project_path: runtime.context.project_path } }
    )
    const base = AGENTS_MD_PROMPT.replace('{{agentsMd}}', agentsMd)
    return new SystemMessage(buildSystemPromptContent(base, plan, critiqueFeedback))
  }

  return new SystemMessage(buildSystemPromptContent(BASE_SYSTEM_PROMPT, plan, critiqueFeedback))
}

export function createExecutorNode(modelWithTools: Runnable<Array<BaseMessage>>) {
  return async (
    state: AgentState,
    runtime: Runtime
  ): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueFeedback } = state

    const hasSystemMessage = messages.some(
      (msg): msg is SystemMessage => msg instanceof SystemMessage
    )

    const messagesWithSystem = hasSystemMessage
      ? messages
      : [await buildSystemPrompt(messages, runtime, plan, critiqueFeedback), ...messages]

    const response = await modelWithTools.invoke(messagesWithSystem)

    return { messages: [response] }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test
```

Expected: PASS — 3 passing in `executor.test.ts`, plus all previous tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/nodes/executor.ts apps/api/src/nodes/__tests__/executor.test.ts
git commit -m "feat(api): add executor node (replaces llm.ts) with plan and critique injection"
```

---

## Task 7: Implement the critic node

The critic reviews the executor's final output against the original request and plan. Returns `{ approved, feedback }` as structured output. Exposes `shouldRetry` as a conditional edge function.

**Files:**
- Create: `apps/api/src/nodes/critic.ts`
- Create: `apps/api/src/nodes/__tests__/critic.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/nodes/__tests__/critic.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { createCriticNode, shouldRetry } from '@/nodes/critic'

const makeModel = (output: { approved: boolean; feedback: string }) => ({
  withStructuredOutput: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(output),
  }),
})

const baseState = {
  messages: [
    new HumanMessage('fix the null pointer bug'),
    new AIMessage('I fixed it by adding a null check'),
  ],
  complexity: 'medium' as const,
  planningDepth: 'detailed' as const,
  plan: '1. Read buggy.ts\n2. Fix null check',
  critiqueAttempts: 0,
  critiqueFeedback: null,
}

describe('createCriticNode', () => {
  it('increments critiqueAttempts on approval', async () => {
    const model = makeModel({ approved: true, feedback: 'Looks good' })
    const node = createCriticNode(model as any)
    const result = await node(baseState)
    expect(result.critiqueAttempts).toBe(1)
    expect(result.critiqueFeedback).toBeNull()
  })

  it('increments critiqueAttempts and sets feedback on rejection', async () => {
    const model = makeModel({ approved: false, feedback: 'Missing error handling in line 42' })
    const node = createCriticNode(model as any)
    const result = await node(baseState)
    expect(result.critiqueAttempts).toBe(1)
    expect(result.critiqueFeedback).toBe('Missing error handling in line 42')
  })

  it('treats model error as approval to avoid hanging', async () => {
    const model = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error('model error')),
      }),
    }
    const node = createCriticNode(model as any)
    const result = await node(baseState)
    expect(result.critiqueAttempts).toBe(1)
    expect(result.critiqueFeedback).toBeNull()
  })
})

describe('shouldRetry', () => {
  it('routes to executor when not approved and attempts <= 2', () => {
    const state = { ...baseState, critiqueAttempts: 1, critiqueFeedback: 'fix the null case' }
    expect(shouldRetry(state)).toBe('executor')
  })

  it('routes to __end__ when approved', () => {
    const state = { ...baseState, critiqueAttempts: 1, critiqueFeedback: null }
    expect(shouldRetry(state)).toBe('__end__')
  })

  it('routes to __end__ when attempts exceed cap', () => {
    const state = { ...baseState, critiqueAttempts: 3, critiqueFeedback: 'still broken' }
    expect(shouldRetry(state)).toBe('__end__')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && pnpm test
```

Expected: FAIL — `Cannot find module '@/nodes/critic'`

- [ ] **Step 3: Implement critic.ts**

Create `apps/api/src/nodes/critic.ts`:
```typescript
import { z } from 'zod'
import type { AgentState } from '@/graphs/agent'

const criticOutputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
})

const CRITIC_SYSTEM_PROMPT = (plan: string | null) => `You are a code review critic evaluating whether a coding assistant fully completed the user's request.

Be practical. Approve if:
- The task is complete even if not perfect
- The approach is sound and accomplishes the goal
- Any code changes are syntactically correct and logically sound

Reject only if:
- The task is clearly incomplete (files mentioned but not changed, steps skipped)
- There are obvious bugs in generated code
- The response doesn't address the actual request

${plan ? `The assistant was following this plan:\n${plan}\n\n` : ''}Return your assessment as structured output.`

export function createCriticNode(model: { withStructuredOutput: (schema: unknown) => { invoke: (messages: unknown) => Promise<unknown> } }) {
  const structuredCritic = model.withStructuredOutput(criticOutputSchema)

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueAttempts = 0 } = state

    const humanMessages = messages.filter(
      m => m.getType?.() === 'human' || (m as any)._getType?.() === 'human'
    )
    const aiMessages = messages.filter(
      m => m.getType?.() === 'ai' || (m as any)._getType?.() === 'ai'
    )

    const latestUserRequest = humanMessages[humanMessages.length - 1]
    const latestResponse = aiMessages[aiMessages.length - 1]

    try {
      const userContent =
        typeof latestUserRequest?.content === 'string'
          ? latestUserRequest.content
          : JSON.stringify(latestUserRequest?.content ?? '')

      const assistantContent =
        typeof latestResponse?.content === 'string'
          ? latestResponse.content
          : JSON.stringify(latestResponse?.content ?? '')

      const result = await structuredCritic.invoke([
        { role: 'system', content: CRITIC_SYSTEM_PROMPT(plan) },
        {
          role: 'user',
          content: `User request:\n${userContent}\n\nAssistant response:\n${assistantContent}`,
        },
      ]) as { approved: boolean; feedback: string }

      return {
        critiqueAttempts: critiqueAttempts + 1,
        critiqueFeedback: result.approved ? null : result.feedback,
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
  if (state.critiqueFeedback !== null && (state.critiqueAttempts ?? 0) <= 2) {
    return 'executor'
  }
  return '__end__'
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && pnpm test
```

Expected: PASS — 3 in `critic.test.ts`, 3 in `shouldRetry` describe block, plus all previous tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/nodes/critic.ts apps/api/src/nodes/__tests__/critic.test.ts
git commit -m "feat(api): add critic node with shouldRetry conditional edge"
```

---

## Task 8: Wire the new graph in agent.ts

Replace the existing graph structure with the new four-phase pipeline. Switch from `ChatOllama` to `ChatOpenAI` for agent models.

**Files:**
- Modify: `apps/api/src/graphs/agent.ts`

- [ ] **Step 1: Update imports in agent.ts**

Replace the `ChatOllama` import with `ChatOpenAI`:
```typescript
// Remove:
import { ChatOllama } from '@langchain/ollama'

// Add:
import { ChatOpenAI } from '@langchain/openai'
```

Add the new node imports:
```typescript
import { createRouterNode } from '@/nodes/router'
import { createPlannerNode } from '@/nodes/planner'
import { createExecutorNode } from '@/nodes/executor'
import { createCriticNode, shouldRetry } from '@/nodes/critic'
```

Remove the old llm node import:
```typescript
// Remove:
import { createLlmNode } from '@/nodes/llm'
```

- [ ] **Step 2: Replace createAgent() body**

Replace the full body of `createAgent()` with:
```typescript
export async function createAgent() {
  const tools = [
    fileSearchTool,
    fileReadTool,
    fileWriteTool,
    shellTool,
    ragSearchTool,
    ...(await client.getTools()),
  ]

  const reasoningModel = new ChatOpenAI({
    model: env.REASONING_MODEL,
    baseURL: env.LM_STUDIO_API_URL,
    apiKey: 'lm-studio',
    temperature: 0,
  })

  const codingModel = new ChatOpenAI({
    model: env.CODING_MODEL,
    baseURL: env.LM_STUDIO_API_URL,
    apiKey: 'lm-studio',
    temperature: 0.3,
    streaming: true,
  })

  const codingModelWithTools = codingModel.bindTools(tools)

  const toolNode = new ToolNode(tools, { handleToolErrors: true })

  const routerNode = createRouterNode(reasoningModel)
  const plannerNode = createPlannerNode(reasoningModel)
  const executorNode = createExecutorNode(codingModelWithTools)
  const criticNode = createCriticNode(reasoningModel)

  const workflow = new StateGraph(agentStateSchema)
    .addNode('title-generator', titleGeneratorNode)
    .addNode('router', routerNode)
    .addNode('planner', plannerNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addNode('critic', criticNode)
    .addEdge(START, 'title-generator')
    .addEdge('title-generator', 'router')
    .addEdge('router', 'planner')
    .addEdge('planner', 'executor')
    .addConditionalEdges('executor', toolsCondition, { tools: 'tools', [END]: 'critic' })
    .addEdge('tools', 'executor')
    .addConditionalEdges('critic', shouldRetry, { executor: 'executor', __end__: END })

  return workflow.compile({
    checkpointer: PostgresSaver.fromConnString(env.DATABASE_URL),
  })
}
```

Note: `toolsCondition` returns `'tools'` or `END` (the `'__end__'` constant). The path map `{ [END]: 'critic' }` redirects that terminal branch to the critic node instead.

- [ ] **Step 3: Delete llm.ts**

```bash
git rm apps/api/src/nodes/llm.ts
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors. Fix any import or type errors before proceeding.

- [ ] **Step 5: Run all tests**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/graphs/agent.ts
git commit -m "feat(api): wire multi-model graph — router → planner → executor → critic"
```

---

## Task 9: Smoke test the full pipeline

Verify the graph runs end-to-end with LM Studio running.

- [ ] **Step 1: Start LM Studio and load models**

Ensure LM Studio is running with both `REASONING_MODEL` and `CODING_MODEL` loaded, serving at `http://localhost:1234/v1`.

- [ ] **Step 2: Start the dev server**

```bash
cd apps/api && pnpm dev
```

Expected: LangGraph dev server starts without errors.

- [ ] **Step 3: Send a simple request via the web app**

Navigate to the web app, create a new thread, and send: `"What does this project do?"` (simple task — should route to `brief` planning depth).

Expected:
- Router classifies as `simple/brief`
- Planner produces a 2-3 step plan
- Executor reads relevant files and answers
- Critic approves in one pass
- Response appears in the UI

- [ ] **Step 4: Send a complex request**

Send: `"Add input validation to all the tool schemas"` (complex task — should route to `decomposed`).

Expected: Planner produces a decomposed sub-task breakdown before execution starts.

- [ ] **Step 5: Commit smoke test confirmation**

```bash
git commit --allow-empty -m "chore: smoke test passed — multi-model loop end-to-end verified"
```
