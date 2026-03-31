# Planner & Critic Subgraphs Design

**Date:** 2026-03-31
**Status:** Approved

## Problem

The planner and critic nodes operate as single LLM calls with no codebase access. The planner generates plans without knowing actual file structure, existing code, or conventions. The critic verifies task completion without being able to read what was actually written. Both produce outputs that are too broad and miss real-world details.

## Solution

Convert both nodes into **ReAct subgraphs** with read-only tool access (`file_read`, `file_search`), enabling them to explore the codebase before producing their output.

## Architecture

Both subgraphs share the same internal shape:

```
[subgraph entry] → research-llm → tools → research-llm → ... → synthesize-llm → [subgraph exit]
```

- `research-llm`: reasoning model with `file_read` and `file_search` bound as tools. Loops until it emits no tool calls.
- `tools`: executes the read-only tool calls.
- `synthesize-llm`: receives the full research transcript (subgraph message history) and produces the final output.
- Each subgraph uses its **own internal message state**. Only the final output is written back to parent graph state (`plan` or `critiqueFeedback` / `approved`).

## Planner Subgraph

**Research phase input:** task description + project context (language, framework, conventions).

**Research prompt:** explore the codebase before planning — read relevant files, follow imports, check existing patterns and conventions.

**Synthesize prompt:** "You have read the codebase. Now write the plan at `{depth}` depth. Do not include file discovery steps — you have already done that."

**Output:** plan string written to `state.plan`, same as today.

**Depth levels unchanged:** `brief` (simple), `detailed` (medium), `decomposed` (complex).

## Critic Subgraph

**Research phase input:** full conversation history (which already contains `file_write` tool results, making written file paths directly available).

**Research prompt:** identify files written during execution from the conversation history, read them, and verify their content matches what the task required. Follow up with related files (imports, configs) as needed.

**Synthesize prompt:** "You have read the relevant files. Now evaluate whether the task is complete. Base your verdict strictly on what you read, not on prose claims in the conversation."

**Output:** `{ approved: boolean; feedback: string }` written to parent state, same as today.

**Retry logic unchanged:** up to 2 retries via `shouldRetry` edge in parent graph.

**Graceful fallback unchanged:** approve on subgraph error to prevent hanging.

## Error Handling

Tool call failures during research are included in the subgraph message history. The synthesize step accounts for them (e.g. "could not read file X, proceeding with available information").

## Observability

Langfuse tracing stays at the parent node boundary — each subgraph is a single span, same as today. No per-tool-call traces inside subgraphs.

## File Changes

- `src/nodes/planner.ts` → replaced by `src/graphs/planner-subgraph.ts`
- `src/nodes/critic.ts` → replaced by `src/graphs/critic-subgraph.ts`
- `src/graphs/agent.ts` → updated to use subgraphs as node replacements
- `src/tools/index.ts` (or equivalent) → read-only tool set extracted for reuse

## What Does Not Change

- Parent graph state schema
- Routing logic (classifier, router, shouldRetry)
- Langfuse integration points
- Tool implementations (`file_read`, `file_search`)
- Executor node
