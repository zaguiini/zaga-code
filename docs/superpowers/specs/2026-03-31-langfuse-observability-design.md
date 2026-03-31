# Langfuse Session Observability — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** `apps/api` only

---

## Goal

Add session observability to the LangGraph agent for two purposes:

1. **Debugging** — trace why the agent made decisions (routing, retries, critique feedback)
2. **Performance monitoring** — track latency and token usage per node and per LLM call

---

## Infrastructure

Langfuse is self-hosted (already cloned and running separately). No Docker Compose changes needed in this repo.

Three env vars added to `apps/api/.env`:

```
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_HOST=http://localhost:3001
```

These are also added to `apps/api/src/env.ts` via the Zod schema.

---

## New Packages

Added to `apps/api`:

- `langfuse` — core SDK for client, spans, and manual metadata annotations
- `langfuse-langchain` — `CallbackHandler` for automatic LangChain/LangGraph tracing

---

## SDK Setup

**File:** `apps/api/src/utils/langfuse.ts`

Exports:

- `langfuse` — a singleton `Langfuse` client instance, flushed on process exit via `process.on('beforeExit')`
- `createCallbackHandler(sessionId: string)` — returns a `CallbackHandler` from `langfuse-langchain`, configured with the LangGraph `thread_id` as `sessionId`

All Langfuse initialization lives here. No other file touches the client directly except for manual metadata annotations.

---

## Node Integration

### Automatic tracing (all model-invoking nodes)

Each node that calls a model passes a `CallbackHandler` into `model.invoke()`:

```ts
const handler = createCallbackHandler(config.configurable?.thread_id)
await model.invoke(messages, { callbacks: [handler] })
```

The `thread_id` is extracted from the `RunnableConfig` each node already receives. This gives:

- One trace per LangGraph run (correlated by session/thread)
- One span per node execution
- One generation span per LLM call, including token counts and latency

Nodes that receive this treatment: **classifier**, **planner**, **executor**, **critic**

The **title-generator** node is excluded — it runs in a background thread and its output is not relevant to agent debugging or performance.

### Manual metadata annotations

Three nodes add targeted metadata after their LLM call using the `langfuse` client directly:

| Node         | Metadata logged                                        |
| ------------ | ------------------------------------------------------ |
| `classifier` | `complexity`, `planningDepth`                          |
| `planner`    | `plan` (the generated plan string)                     |
| `critic`     | `critiqueFeedback`, `critiqueAttempts`, retry decision |

These annotations capture agent-specific decision state that the automatic CallbackHandler cannot infer from raw LLM inputs/outputs. They are what make traces useful for debugging (e.g., "why did the agent retry? → critique said X").

The **executor** node gets the CallbackHandler for LLM + tool call tracing but no manual annotations — tool invocations are captured automatically by the LangChain callback system.

---

## Data Model

```
Langfuse Trace
└── sessionId: thread_id (LangGraph thread)
    └── Span: classifier
        └── Generation: LLM call (tokens, latency)
        └── Metadata: complexity, planningDepth
    └── Span: planner (conditional)
        └── Generation: LLM call
        └── Metadata: plan
    └── Span: executor
        └── Generation: LLM call
        └── Tool calls (automatic via callback)
    └── Span: critic
        └── Generation: LLM call
        └── Metadata: critiqueFeedback, critiqueAttempts, shouldRetry
    └── Span: executor (retry, if applicable)
        └── ...
```

---

## Out of Scope

- Frontend tracing (web layer)
- Langfuse evaluations / scoring
- User identity tracking
- Custom dashboards or alerts
