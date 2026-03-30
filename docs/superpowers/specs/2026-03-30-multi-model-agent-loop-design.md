# Multi-Model Agent Loop Design

**Date:** 2026-03-30
**Status:** Approved

## Overview

Replace the current single-model ReAct loop with a four-phase pipeline: route → plan → execute → critique. Different models handle different phases based on their strengths. Planning happens before execution. A separate critic model reviews the result and can trigger a targeted retry.

## Graph Structure

```
START → title-generator → router → planner → executor ⇄ tools → critic ─┐
                                                         ▲                │ not approved, attempts < 2
                                                         └────────────────┘
                                                                          │ approved OR attempts >= 2
                                                                         END
```

## State Schema

Extends the existing `MessagesAnnotation` with:

```typescript
{
  messages: BaseMessage[]       // existing

  // set by router, never mutated after
  complexity: 'simple' | 'medium' | 'complex'
  planningDepth: 'brief' | 'detailed' | 'decomposed'

  // set by planner
  plan: string | null

  // critic loop
  critiqueAttempts: number      // starts at 0, incremented each critic pass
  critiqueFeedback: string | null
}
```

## Nodes

### `router`
- **Model:** `REASONING_MODEL` (Qwen3-30B)
- **Tools:** none
- **Output:** structured Zod schema `{ complexity, planningDepth }`
- Reads the first human message and classifies the request:
  - `simple` → `brief` (explain code, answer a question — still needs files, just a short plan)
  - `medium` → `detailed` (debug, single-file changes)
  - `complex` → `decomposed` (multi-file features, refactors)
- On failure: defaults to `{ complexity: 'medium', planningDepth: 'detailed' }`

### `planner`
- **Model:** `REASONING_MODEL` (Qwen3-30B) with thinking enabled (`/think` prefix)
- **Tools:** none
- **Output:** markdown plan string stored in `state.plan`
- Calibrates depth by `planningDepth`:
  - `brief`: 2-3 step plan (which files to read, what to answer)
  - `detailed`: numbered steps — files to inspect, changes to make, order of operations
  - `decomposed`: sub-tasks with dependencies spelled out
- Output format is always the same markdown structure regardless of depth — keeps executor injection simple
- On empty output: executor falls back to base system prompt (today's behavior)

### `executor`
- **Model:** `CODING_MODEL` (Qwen3-Coder-30B)
- **Tools:** all existing tools (file_read, file_search, file_write, shell, rag_file_search)
- The existing ReAct loop, unchanged in structure
- System prompt augmented with:
  - The plan from `state.plan` (always, if present)
  - On retries: "A previous attempt was reviewed and found these issues: `{critiqueFeedback}`"
- Terminates when the model stops calling tools (existing `toolsCondition` edge)

### `critic`
- **Model:** `REASONING_MODEL` (Qwen3-30B)
- **Tools:** none
- **Output:** structured Zod schema `{ approved: boolean, feedback: string }`
- Receives: full conversation history + original plan + user request
- Evaluates whether the executor actually completed the task correctly and completely
- Result is internal — never surfaced to the user
- On critic node error: treats as `{ approved: true }` and routes to END

## Conditional Edges

```
critic → executor  if !approved && critiqueAttempts < 2
critic → END       if approved || critiqueAttempts >= 2
```

`critiqueAttempts` is incremented inside the critic node before the edge is evaluated.

## Model Configuration

Replaces current `AGENT_MODEL` with two env vars:

| Var | Purpose | Recommended model |
|-----|---------|-------------------|
| `REASONING_MODEL` | router, planner, critic | `qwen3-30b` |
| `CODING_MODEL` | executor | `qwen3-coder-30b` |
| `LM_STUDIO_API_URL` | LM Studio base URL | `http://localhost:1234/v1` |

Existing `SUMMARIZATION_MODEL` (title generator) and `RAG_MODEL` / `OLLAMA_API_URL` remain unchanged for now — title generation and embeddings are separate concerns.

## LLM Client Change

All agent nodes switch from `ChatOllama` (`@langchain/ollama`) to `ChatOpenAI` (`@langchain/openai`) with:

```typescript
new ChatOpenAI({
  model: env.REASONING_MODEL, // or CODING_MODEL
  baseURL: env.LM_STUDIO_API_URL,
  apiKey: 'lm-studio', // required field, value ignored by LM Studio
})
```

The RAG embedding pipeline (`OllamaEmbeddings`) is unaffected.

## Files Affected

- `apps/api/src/env.ts` — add `REASONING_MODEL`, `CODING_MODEL`, `LM_STUDIO_API_URL`; remove `AGENT_MODEL`
- `apps/api/src/graphs/agent.ts` — new graph structure, new state schema, new nodes wired in
- `apps/api/src/nodes/llm.ts` — becomes `executor.ts`, switches to `ChatOpenAI`, injects plan + critique feedback
- `apps/api/src/nodes/router.ts` — new file
- `apps/api/src/nodes/planner.ts` — new file
- `apps/api/src/nodes/critic.ts` — new file
- `apps/api/src/nodes/title-generator.ts` — unchanged
