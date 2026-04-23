# Agent Harness V2 Design (Phase 1 + Phase 2)

## 1. Summary

This design replaces LangChain/LangGraph runtime orchestration in `apps/agent/src` with a custom harness that:

- Supports any OpenAI-compatible endpoint for model calls.
- Keeps reasoning and tool usage enabled together.
- Makes tool-calling reliability a first-class runtime concern.
- Simplifies frontend stream handling with a purpose-built event protocol.
- Avoids disruption by using branch-based migration (`main` untouched during phase work).

## 2. Goals

- Remove framework-coupled orchestration from the critical runtime path.
- Preserve current product behavior and visual UX while improving internal architecture.
- Fix failure mode where tool calls are mixed into reasoning streams and break parsing.
- De-risk phase 1 by explicitly migrating subagents in phase 2.
- Keep migration incremental and reversible.

## 3. Non-Goals

- Rebuilding every existing feature in phase 1.
- Visual redesign of frontend components.
- Supporting non-tool-capable models via implicit heuristics in phase 1.

## 4. Constraints and Decisions

- Main branch remains stable; migration happens in dedicated branches.
- Phase 1 uses a narrower core runtime first, then phase 2 restores full feature parity.
- Phase 1 adopts a strict provider capability contract for structured tool calls.
- Phase 1 supports OpenAI-compatible providers only; non-OpenAI adapters are deferred.
- Frontend visuals remain the same; only protocol/reducer-level changes are allowed.

## 5. Branch Strategy

### 5.1 Branches

- `main`: production/stable behavior, no disruptive migration changes.
- `agent-runtime-v2`: integration branch for the full LangGraph-to-harness migration.
- `phase-1/harness-core`: new harness, new stream protocol, reliable tool-calling core.
- `phase-2/parity`: extends phase 1 with full parity features.

### 5.2 Merge Strategy

- Phase 1 merges into `agent-runtime-v2` only when functional acceptance criteria pass and visual regressions are absent.
- Phase 2 rebases/merges on top of phase 1 and lands in `agent-runtime-v2` only after parity checklist is complete.

## 6. Architecture Overview

### 6.1 Core Modules

- `runtime/agent-runtime.ts`: interface for invoke/stream/getState/updateState.
- `runtime/harness-runtime.ts`: custom harness implementation.
- `runtime/langgraph-runtime.ts` (temporary): adapter used for migration/reference.
- `runtime/events.ts`: canonical v2 event schema.
- `runtime/loop.ts`: orchestrator step loop.
- `runtime/tool-executor.ts`: tool invocation + streaming + result normalization.
- `runtime/model/openai-compatible.ts`: model adapter using OpenAI SDK with `baseURL` support.
- `runtime/capabilities.ts`: provider/model tool-capability checks.
- `runtime/subagents.ts` (phase 2): subagent run lifecycle and scope propagation.

### 6.2 Runtime Interfaces

```ts
import type OpenAI from 'openai'
import type { AgentState } from '@/graphs/agent'

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface AgentRuntime<
  TEvent = UiEvent<OpenAIMessage, AgentState>,
  TResult = RunResult<OpenAIMessage>,
> {
  stream(input: RunInput, opts?: RunOptions): AsyncIterable<TEvent>
  invoke(input: RunInput, opts?: RunOptions): Promise<TResult>
  getState(threadId: string): Promise<AgentState>
  updateState(threadId: string, patch: Partial<AgentState>): Promise<void>
}

export type ToolContext = {
  threadId: string
  projectPath: string
  toolCallId: string
  runScope: RunScope
  signal?: AbortSignal
}
```

### 6.3 State Management Contract

- Runtime state transitions are owned by a typed reducer (deterministic updates).
- `zod` is used at runtime boundaries only: DB payloads, tool input/output payloads, model/provider normalization, and API payloads.
- Reducer outputs are not re-validated by `zod` in the normal path; optional debug assertions are allowed.
- Action payloads are validated before reducer dispatch when they cross runtime boundaries.

## 7. Event Protocol V2

Phase 1 introduces a UI-native stream protocol (top-level runs only):

```ts
type RunScope = {
  runId: string
  parentToolCallId?: string
  depth: number
}

type UiEvent =
  | { type: 'run.started'; scope: RunScope; threadId: string }
  | { type: 'assistant.reasoning_delta'; scope: RunScope; messageId: string; delta: string }
  | { type: 'assistant.text_delta'; scope: RunScope; messageId: string; delta: string }
  | { type: 'assistant.tool_call'; scope: RunScope; messageId: string; toolCall: ToolCall }
  | { type: 'tool.started'; scope: RunScope; toolCallId: string; name: string; input: unknown }
  | { type: 'tool.delta'; scope: RunScope; toolCallId: string; data: unknown }
  | {
      type: 'tool.completed'
      scope: RunScope
      toolCallId: string
      output: unknown
      metadata?: Record<string, unknown>
    }
  | { type: 'assistant.completed'; scope: RunScope; message: Message }
  | { type: 'run.completed'; scope: RunScope; finalState: AgentState }
  | { type: 'run.failed'; scope: RunScope; error: { code: string; message: string } }
```

### 7.1 Why this fixes frontend complexity

- Removes dependency on LangChain `StreamEvent` internals.
- Removes reducer logic that reconstructs fragmented `tool_calls` arrays.
- Keeps the frontend reducer focused on direct top-level event handling.

## 8. Main Loop Behavior

1. Validate provider/model capabilities for structured tool calls.
2. Emit `run.started`.
3. Build prompt/messages from persisted state and run input.
4. Call model via OpenAI-compatible adapter with streaming enabled.
5. Normalize incoming deltas into distinct reasoning/text/tool-call events.
6. When tool calls are complete, execute tools and stream tool events.
7. Append tool results as tool messages and continue loop.
8. Stop on assistant completion with no tool calls, cancellation, or limits.
9. Persist final state and emit `run.completed`.

## 9. Tool-Calling Reliability Strategy (Phase 1)

### 9.1 Strict Capability Contract

- A model/provider is considered compatible only if it emits valid structured tool calls for a runtime probe.
- If probe fails, run terminates with a clear compatibility error (`run.failed`) and actionable message.
- No silent fallback to ad-hoc JSON parsing in phase 1.

### 9.2 Parsing Rules

- Tool calls are parsed only from structured tool-call fields.
- Reasoning deltas are never parsed as tool-call payload.
- Incomplete tool calls are buffered until complete or timeout.
- Invalid tool-call objects fail deterministically with schema errors.

### 9.3 Reasoning + Tool Coexistence

- Reasoning stays enabled for all turns.
- Tool-call extraction is independent from reasoning stream text.
- UI receives separate event types for reasoning and tools.

## 10. Model Calling (OpenAI-Compatible)

### 10.1 Adapter

Use official OpenAI SDK with configurable base URL:

- `baseURL`: local/remote OpenAI-compatible endpoint.
- `apiKey`: provider token or local placeholder.
- `model`: arbitrary compatible model id.
- `stream: true` for token and tool-call deltas.

### 10.2 Compatibility Matrix in Settings

Add explicit settings/diagnostics fields:

- `supportsStructuredTools` (runtime-detected)
- `supportsReasoningDeltas` (runtime-observed)
- `lastCapabilityCheckAt`
- `capabilityCheckError`

This powers better debugging for LM Studio/SwiftLM model swaps.

## 11. Subagent Design (Phase 2)

- Subagent invocation starts a nested run scope (`depth + 1`, `parentToolCallId` set).
- Nested events are streamed with explicit scope.
- Parent tool call collects nested outputs as its result artifact.
- Frontend groups nested activity under the parent tool call without namespace parsing hacks.

## 12. Frontend Changes

### 12.1 Keep visual behavior stable

- Existing message rendering stays visually equivalent.
- Changes limited to stream subscription handling and reducer state transitions.

### 12.2 New reducer behavior

- Event-driven append/update by event type.
- No reconstruction of `additional_kwargs.tool_calls`.
- Tool progress keyed by `toolCallId` with optional nested run timelines.

## 13. Persistence and State

Phase 1:

- Reuse existing thread/run DB tables where possible.
- Persist message state after each loop step.
- Keep cancel/resume semantics currently exposed by `runs` endpoints.

Phase 2:

- Restore/expand checkpoint features currently tied to LangGraph internals.

## 14. Error Handling

- Deterministic error codes:
  - `MODEL_CAPABILITY_UNSUPPORTED`
  - `MODEL_TOOL_CALL_PARSE_ERROR`
  - `TOOL_EXECUTION_ERROR`
  - `RUN_ABORTED`
  - `RUN_STEP_LIMIT_EXCEEDED`
- All emitted through `run.failed` with user-safe message and diagnostic details.

## 15. Verification Strategy

### 15.0 Explicit Rewrite Policy

- No new unit tests will be added as part of this rewrite.
- Future implementation work for this rewrite should not add or require unit test coverage.
- Validation focus is end-to-end behavior, integration checks, and manual verification.

### 15.1 Phase 1 Required

- Integration: end-to-end run with tool call + reasoning + tool result.
- Integration: known-bad provider output emits explicit compatibility failure.
- Frontend: manual verification of v2 event protocol behavior for top-level runs.

### 15.2 Phase 2 Required

- Integration/manual parity validation for memory compaction, dynamic MCP tools, advanced state operations, and subagent scope/event behavior.

## 16. Rollout Plan

1. Create `phase-1/harness-core` branch.
2. Add runtime interfaces and OpenAI-compatible model adapter.
3. Implement harness loop + v2 event stream endpoint.
4. Add frontend v2 reducer/subscription path (same visuals).
5. Run reliability tests on OpenAI + LM Studio + SwiftLM sample models.
6. Merge phase 1 into `agent-runtime-v2` when acceptance criteria pass.
7. Create `phase-2/parity` branch from `agent-runtime-v2`.
8. Add parity features incrementally with validation gates.

## 17. Acceptance Criteria

Phase 1 is complete when:

- Runs stream with v2 protocol and preserve current visual UX.
- Reasoning and tool calls coexist consistently in one run.
- Structured tool-call unsupported models fail fast with clear error.
- Legacy reducer complexity is removed from active runtime path.

Phase 2 is complete when:

- Feature parity checklist with current LangGraph-based behavior is fully satisfied.
- Subagent execution and scoped subagent streaming are migrated and stable.

## 18. Risks and Mitigations

- Risk: Provider incompatibilities vary by model version.
  - Mitigation: capability probe + explicit diagnostics + strict error codes.
- Risk: Dual protocol migration causes temporary complexity.
  - Mitigation: gate v2 behind feature flag during transition, then remove v1.
- Risk: Phase 2 subagent event fan-out increases stream volume.
  - Mitigation: apply event coalescing strategy during phase 2 rollout.

## 19. Phase 1 Default Decisions

- Keep `runs.stream` (v1) during migration and introduce `runs.streamV2`; remove v1 only after v2 rollout is complete.
- Capability probe uses a deterministic single-tool schema (`tool_ping`) with strict argument validation and a fixed expected call.
- New runtime modules live under `apps/agent/src/runtime/*`; keep naming from this document unless implementation reveals a conflict.
