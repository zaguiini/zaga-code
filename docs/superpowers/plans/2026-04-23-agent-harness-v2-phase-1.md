# Agent Harness V2 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship phase 1 of the LangGraph-to-harness migration with reliable structured tool calls and a simplified v2 stream protocol while preserving current UI visuals.

**Architecture:** Introduce a custom `AgentRuntime` and `HarnessRuntime` in `apps/agent/src/runtime`, add `runs.streamV2` with explicit UI-native events and run scopes, and wire the frontend to a new reducer that consumes v2 events without LangGraph event reconstruction logic. Keep `runs.stream` (v1) available during migration and keep `main` untouched by landing phase work into integration branch `agent-runtime-v2`.

**Tech Stack:** TypeScript, Node.js, tRPC, OpenAI SDK (`baseURL` for OpenAI-compatible endpoints), React, existing SQLite-backed persistence.

---

## Rewrite Policy (Must Follow)

- No new unit tests in this rewrite.
- Do not add or require Vitest/Jest unit tests in phase 1 tasks.
- Verification is integration/manual only.

## File Structure (Phase 1)

### New files

- `apps/agent/src/runtime/agent-runtime.ts`: runtime interfaces (`RunInput`, `RunResult`, `RunOptions`, `AgentRuntime`).
- `apps/agent/src/runtime/events.ts`: canonical v2 event types (`UiEvent`, `RunScope`, payload types).
- `apps/agent/src/runtime/model/openai-compatible.ts`: model adapter using OpenAI SDK with configurable `baseURL` and streaming.
- `apps/agent/src/runtime/capabilities.ts`: strict structured-tool capability probe and diagnostics.
- `apps/agent/src/runtime/harness-runtime.ts`: main orchestration loop and event emission.
- `apps/agent/src/runtime/tool-context.ts`: runtime-native `ToolContext` contract.
- `apps/agent/src/server/router/runs-v2.ts`: helper utilities for buffering and tracking v2 events.
- `apps/web/src/hooks/stream-reducer-v2.ts`: reduced-complexity reducer for v2 protocol.

### Modified files

- `apps/agent/src/server/trpc.ts`: context type from `graph` to `runtime`.
- `apps/agent/src/server/index.ts`: instantiate and inject runtime into tRPC context.
- `apps/agent/src/server/router/runs.ts`: add `startV2` / `streamV2` / `cancelV2` using runtime.
- `apps/agent/src/settings.ts`: connection/runtime settings used by OpenAI-compatible adapter.
- `apps/agent/src/tools/file-write.ts`: convert to runtime-native context input shape.
- `apps/agent/src/tools/shell.ts`: convert generator tool to runtime-native context input shape.
- `apps/agent/src/tools/file-read.ts`: preserve metadata behavior with runtime-native context.
- `apps/agent/src/utils/create-agent-tool.ts`: emit subagent lifecycle through v2 scope semantics.
- `apps/web/src/hooks/use-agent-stream.ts`: consume `streamV2` and reducer-v2 path.
- `apps/web/src/lib/message-grouper.ts`: map v2 tool progress shape while preserving existing visuals.

### Existing files intentionally untouched in phase 1

- `apps/agent/src/graphs/agent.ts`
- `apps/agent/src/nodes/*` (except compatibility glue if needed)
- `apps/web/src/components/*` visual structure

### Branches used

- `main`: stable baseline.
- `phase-1/harness-core`: implementation branch for this plan.
- `agent-runtime-v2`: integration branch receiving phase merges.

---

### Task 1: Create Branch Layout and Safety Rails

**Files:**

- Modify: `docs/superpowers/plans/2026-04-23-agent-harness-v2-phase-1.md`

- [ ] **Step 1: Create integration branch from `main` (once)**

Run:

```bash
git checkout main
git pull --ff-only
git checkout -b agent-runtime-v2
```

Expected: branch `agent-runtime-v2` exists locally and tracks integration work.

- [ ] **Step 2: Create phase-1 branch from integration branch**

Run:

```bash
git checkout agent-runtime-v2
git checkout -b phase-1/harness-core
```

Expected: active branch is `phase-1/harness-core`.

- [ ] **Step 3: Verify no unrelated local drift before coding**

Run:

```bash
git status --short
```

Expected: clean tree or only expected spec/plan files.

- [ ] **Step 4: Commit branch setup notes (if plan file changed)**

Run:

```bash
git add docs/superpowers/plans/2026-04-23-agent-harness-v2-phase-1.md
git commit -m "docs: add phase-1 harness implementation plan"
```

Expected: one docs-only commit.

### Task 2: Add Runtime Contracts and V2 Event Schema

**Files:**

- Create: `apps/agent/src/runtime/agent-runtime.ts`
- Create: `apps/agent/src/runtime/events.ts`
- Create: `apps/agent/src/runtime/tool-context.ts`
- Modify: `apps/agent/src/server/trpc.ts`

- [ ] **Step 1: Add runtime interface definitions**

Create `apps/agent/src/runtime/agent-runtime.ts`:

```ts
import type { UiEvent } from './events'

export type RunInput = {
  threadId: string
  projectPath: string
  text: string
  images: Array<{ name: string; mimeType: string; url: string }>
}

export type RunOptions = {
  signal?: AbortSignal
  maxSteps?: number
}

export type RunResult = {
  messages: Array<Record<string, unknown>>
}

export interface AgentRuntime {
  stream(input: RunInput, opts?: RunOptions): AsyncIterable<UiEvent>
  invoke(input: RunInput, opts?: RunOptions): Promise<RunResult>
  cancel(threadId: string): void
}
```

- [ ] **Step 2: Add v2 event protocol types with explicit scope**

Create `apps/agent/src/runtime/events.ts`:

```ts
export type RunScope = {
  runId: string
  parentToolCallId?: string
  depth: number
}

export type UiEvent =
  | { type: 'run.started'; scope: RunScope; threadId: string }
  | { type: 'assistant.reasoning_delta'; scope: RunScope; messageId: string; delta: string }
  | { type: 'assistant.text_delta'; scope: RunScope; messageId: string; delta: string }
  | {
      type: 'assistant.tool_call'
      scope: RunScope
      messageId: string
      toolCall: { id: string; name: string; args: Record<string, unknown> }
    }
  | { type: 'tool.started'; scope: RunScope; toolCallId: string; name: string; input: unknown }
  | { type: 'tool.delta'; scope: RunScope; toolCallId: string; data: unknown }
  | {
      type: 'tool.completed'
      scope: RunScope
      toolCallId: string
      output: unknown
      metadata?: Record<string, unknown>
    }
  | { type: 'subagent.started'; scope: RunScope; toolCallId: string; agentName: string }
  | { type: 'subagent.completed'; scope: RunScope; toolCallId: string }
  | { type: 'assistant.completed'; scope: RunScope; message: Record<string, unknown> }
  | { type: 'run.completed'; scope: RunScope; finalState: Record<string, unknown> }
  | { type: 'run.failed'; scope: RunScope; error: { code: string; message: string } }
```

- [ ] **Step 3: Add runtime-native tool context contract**

Create `apps/agent/src/runtime/tool-context.ts`:

```ts
import type { RunScope } from './events'

export type ToolContext = {
  threadId: string
  projectPath: string
  toolCallId: string
  runScope: RunScope
  signal?: AbortSignal
}
```

- [ ] **Step 4: Swap tRPC context to runtime**

Update `apps/agent/src/server/trpc.ts`:

```ts
import type { AgentRuntime } from '@/runtime/agent-runtime'

export type Context = {
  runtime: AgentRuntime
}
```

- [ ] **Step 5: Verify typecheck for agent package**

Run:

```bash
pnpm --filter @zaga/agent build
```

Expected: successful TypeScript build.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/agent/src/runtime/agent-runtime.ts apps/agent/src/runtime/events.ts apps/agent/src/runtime/tool-context.ts apps/agent/src/server/trpc.ts
git commit -m "feat(agent): add runtime contracts and v2 event schema"
```

### Task 3: Implement OpenAI-Compatible Model Adapter + Capability Probe

**Files:**

- Create: `apps/agent/src/runtime/model/openai-compatible.ts`
- Create: `apps/agent/src/runtime/capabilities.ts`
- Modify: `apps/agent/src/settings.ts`
- Modify: `apps/agent/src/utils/fetch-context-length.ts`

- [ ] **Step 1: Add provider-agnostic OpenAI adapter scaffold**

Create `apps/agent/src/runtime/model/openai-compatible.ts`:

```ts
import OpenAI from 'openai'

export function createOpenAICompatibleClient(input: {
  apiKey: string
  model: string
  baseURL?: string
}) {
  const client = new OpenAI({
    apiKey: input.apiKey,
    ...(input.baseURL ? { baseURL: input.baseURL } : {}),
  })

  return { client, model: input.model }
}
```

- [ ] **Step 2: Add strict tool capability probe**

Create `apps/agent/src/runtime/capabilities.ts`:

```ts
import type OpenAI from 'openai'

export async function assertStructuredToolSupport(client: OpenAI, model: string) {
  const completion = await client.chat.completions.create({
    model,
    stream: false,
    messages: [{ role: 'user', content: 'Call tool_ping with {"value":"ok"}.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'tool_ping',
          description: 'Probe tool support',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'tool_ping' } },
  })

  const toolCalls = completion.choices[0]?.message?.tool_calls ?? []
  if (toolCalls.length === 0) {
    throw new Error('MODEL_CAPABILITY_UNSUPPORTED: structured tool calls not emitted')
  }
}
```

- [ ] **Step 3: Extend settings for capability diagnostics (no UI change yet)**

Update `apps/agent/src/settings.ts` to support persisted fields:

```ts
supportsStructuredTools?: boolean
supportsReasoningDeltas?: boolean
lastCapabilityCheckAt?: string
capabilityCheckError?: string
```

- [ ] **Step 4: Remove hard dependency on LM Studio SDK for context length in non-LM environments**

Update `apps/agent/src/utils/fetch-context-length.ts` to:

```ts
// Prefer configured/static context windows first, then provider-specific fallback.
```

and ensure non-LM providers do not throw LM-specific errors.

- [ ] **Step 5: Manual adapter verification against local OpenAI-compatible endpoint**

Run:

```bash
pnpm --filter @zaga/agent dev
```

Then execute one probe run and verify:

- compatible model returns success
- incompatible model returns explicit `MODEL_CAPABILITY_UNSUPPORTED`

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/agent/src/runtime/model/openai-compatible.ts apps/agent/src/runtime/capabilities.ts apps/agent/src/settings.ts apps/agent/src/utils/fetch-context-length.ts
git commit -m "feat(agent): add openai-compatible adapter and strict tool capability checks"
```

### Task 4: Implement Harness Runtime Main Loop

**Files:**

- Create: `apps/agent/src/runtime/harness-runtime.ts`
- Modify: `apps/agent/src/server/index.ts`
- Modify: `apps/agent/src/server/router/runs.ts`

- [ ] **Step 1: Add harness runtime skeleton with stream/invoke/cancel**

Create `apps/agent/src/runtime/harness-runtime.ts`:

```ts
import type { AgentRuntime, RunInput, RunOptions, RunResult } from './agent-runtime'
import type { UiEvent } from './events'

export class HarnessRuntime implements AgentRuntime {
  private abortByThread = new Map<string, AbortController>()

  async *stream(input: RunInput, opts: RunOptions = {}): AsyncIterable<UiEvent> {
    const runId = crypto.randomUUID()
    const scope = { runId, depth: 0 }
    yield { type: 'run.started', scope, threadId: input.threadId }
    // loop implementation lives here
    yield { type: 'run.completed', scope, finalState: { messages: [] } }
  }

  async invoke(input: RunInput, opts: RunOptions = {}): Promise<RunResult> {
    const events: UiEvent[] = []
    for await (const event of this.stream(input, opts)) events.push(event)
    return { messages: [] }
  }

  cancel(threadId: string) {
    this.abortByThread.get(threadId)?.abort()
  }
}
```

- [ ] **Step 2: Instantiate `HarnessRuntime` in server context**

Update `apps/agent/src/server/index.ts`:

```ts
import { HarnessRuntime } from '@/runtime/harness-runtime'

const runtime = new HarnessRuntime()
createContext: () => ({ runtime })
```

- [ ] **Step 3: Add v2 run start/stream/cancel procedures while keeping v1**

Update `apps/agent/src/server/router/runs.ts` by adding:

```ts
startV2
streamV2
cancelV2
```

that use `ctx.runtime` and preserve existing run-buffer reconnection semantics.

- [ ] **Step 4: Manual API verification**

Run:

```bash
pnpm --filter @zaga/agent dev
```

Verify via UI or tRPC client:

- `startV2` returns run id
- `streamV2` emits ordered events
- `cancelV2` aborts active run and emits terminal status

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/agent/src/runtime/harness-runtime.ts apps/agent/src/server/index.ts apps/agent/src/server/router/runs.ts
git commit -m "feat(agent): add harness runtime and v2 run endpoints"
```

### Task 5: Port Core Tools to Runtime-Native Context

**Files:**

- Modify: `apps/agent/src/tools/file-write.ts`
- Modify: `apps/agent/src/tools/file-read.ts`
- Modify: `apps/agent/src/tools/shell.ts`
- Modify: `apps/agent/src/tools/file-search.ts`
- Modify: `apps/agent/src/utils/create-agent-tool.ts`

- [ ] **Step 1: Introduce runtime-native tool handler signatures**

Pattern to apply:

```ts
export async function fileWriteHandler(input: FileWriteInput, ctx: ToolContext) {
  // business logic here
}
```

Then keep temporary LangChain wrappers only where compatibility is still needed.

- [ ] **Step 2: Move path resolution to explicit context fields**

Replace `getCurrentTaskInput<AgentState>()` usage with `ctx.projectPath` in each migrated tool.

- [ ] **Step 3: Preserve rich tool output metadata**

Keep the behavior equivalent to current metadata output:

```ts
{ format: 'code', language: extension }
{ format: 'markdown' }
```

for file and search tools.

- [ ] **Step 4: Update subagent tool flow to emit scoped subagent events**

In `apps/agent/src/utils/create-agent-tool.ts`, ensure nested runs emit:

```ts
{ type: 'subagent.started', ... }
{ type: 'subagent.completed', ... }
```

with `parentToolCallId` scope linkage.

- [ ] **Step 5: Manual reliability verification (reasoning + tools always on)**

Run:

```bash
pnpm --filter @zaga/agent dev
```

Run multiple prompts with Qwen/GLM through LM Studio/SwiftLM and verify:

- reasoning deltas continue streaming
- tool calls are parsed from structured fields only
- no tool-call parsing from reasoning text

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/agent/src/tools/file-write.ts apps/agent/src/tools/file-read.ts apps/agent/src/tools/shell.ts apps/agent/src/tools/file-search.ts apps/agent/src/utils/create-agent-tool.ts
git commit -m "refactor(agent): migrate core tools to runtime-native context"
```

### Task 6: Add Frontend Stream V2 Reducer and Hook Integration

**Files:**

- Create: `apps/web/src/hooks/stream-reducer-v2.ts`
- Modify: `apps/web/src/hooks/use-agent-stream.ts`
- Modify: `apps/web/src/lib/message-grouper.ts`
- Keep (unchanged): `apps/web/src/hooks/stream-reducer.ts` during migration

- [ ] **Step 1: Add simplified reducer for v2 events**

Create `apps/web/src/hooks/stream-reducer-v2.ts`:

```ts
export function streamReducerV2(state: StreamStateV2, action: StreamActionV2): StreamStateV2 {
  // event-type-driven updates only
  return state
}
```

with direct handling for:

- `assistant.reasoning_delta`
- `assistant.text_delta`
- `assistant.tool_call`
- `tool.started`
- `tool.completed`
- `subagent.started`
- `subagent.completed`

- [ ] **Step 2: Wire `use-agent-stream` to v2 endpoints**

Update `apps/web/src/hooks/use-agent-stream.ts` to use:

```ts
trpc.runs.startV2
trpc.runs.streamV2
trpc.runs.cancelV2
```

while preserving current hook return shape consumed by components.

- [ ] **Step 3: Keep visuals unchanged in message grouping**

Update `apps/web/src/lib/message-grouper.ts` mappings only as needed for new progress/result payload shape; do not alter rendered UI structure.

- [ ] **Step 4: Manual frontend verification**

Run:

```bash
pnpm dev
```

Verify:

- message layout unchanged
- reasoning panel behavior unchanged
- tool progress rendering unchanged
- nested/subagent activity grouped correctly under parent tool call

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/hooks/stream-reducer-v2.ts apps/web/src/hooks/use-agent-stream.ts apps/web/src/lib/message-grouper.ts
git commit -m "feat(web): add v2 stream reducer and runtime event integration"
```

### Task 7: Manual Integration Hardening and Cleanup

**Files:**

- Modify: `apps/agent/src/server/router/runs.ts`
- Modify: `apps/agent/src/runtime/harness-runtime.ts`
- Modify: `apps/web/src/hooks/use-agent-stream.ts`
- Modify: `README.md`

- [ ] **Step 1: Add migration notes and temporary dual-protocol behavior**

In `README.md`, add a short section documenting:

- `runs.stream` (legacy)
- `runs.streamV2` (active migration path)
- phase branches (`phase-1/harness-core`, `agent-runtime-v2`).

- [ ] **Step 2: Validate cancellation, reconnection, and replay semantics**

Run a manual matrix:

```bash
pnpm --filter @zaga/agent dev
pnpm --filter web dev
```

Scenarios:

- cancel mid-tool execution
- browser refresh during stream and resume from last event
- network interruption and reconnection

- [ ] **Step 3: Run lint/build checks (no unit tests)**

Run:

```bash
pnpm --filter @zaga/agent lint
pnpm --filter web lint
pnpm --filter @zaga/agent build
pnpm --filter web build
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/agent/src/server/router/runs.ts apps/agent/src/runtime/harness-runtime.ts apps/web/src/hooks/use-agent-stream.ts README.md
git commit -m "chore: stabilize v2 harness migration path and docs"
```

### Task 8: Phase-1 Merge to Integration Branch

**Files:**

- No code changes required; branch management only.

- [ ] **Step 1: Rebase and final smoke-check on phase branch**

Run:

```bash
git checkout phase-1/harness-core
git fetch origin
git rebase origin/agent-runtime-v2
pnpm --filter @zaga/agent lint
pnpm --filter web lint
```

Expected: clean rebase and passing lint.

- [ ] **Step 2: Merge phase 1 into integration branch**

Run:

```bash
git checkout agent-runtime-v2
git merge --no-ff phase-1/harness-core -m "merge: phase-1 harness core into agent-runtime-v2"
```

Expected: phase 1 work now in `agent-runtime-v2`.

- [ ] **Step 3: Push integration branch for review**

Run:

```bash
git push -u origin agent-runtime-v2
```

Expected: integration branch updated remotely.

- [ ] **Step 4: Create phase 2 branch for parity work**

Run:

```bash
git checkout -b phase-2/parity
```

Expected: phase-2 branch created from `agent-runtime-v2` head.

---

## Manual Verification Checklist (Phase 1 Exit)

- [ ] Reasoning and tool calls are both enabled and stream consistently.
- [ ] Tool calls are read from structured tool-call fields only.
- [ ] Unsupported structured tool providers fail with explicit compatibility error.
- [ ] Subagent activity is represented via explicit scoped events.
- [ ] Frontend visual behavior remains equivalent to pre-rewrite UI.
- [ ] No new unit tests were introduced.

## Out of Scope (Phase 2)

- Full parity for all LangGraph-specific checkpoint/state internals.
- Deep memory compaction parity.
- Full dynamic MCP parity and all advanced edge-case flows.
