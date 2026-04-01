# 02 — LLM Setup

## Model Strategy

### Single Model vs Two Models

A single model is simpler to manage but forces a tradeoff: either you pick a coding specialist and get weaker planning/reasoning, or you pick a general model and get weaker code generation.

The agent architecture has nodes with fundamentally different jobs:

| Node             | What it needs                        | Optimal model type            |
| ---------------- | ------------------------------------ | ----------------------------- |
| Explore subgraph | Many short calls, read comprehension | Fast general                  |
| Plan node        | Single call, structured reasoning    | General with strong reasoning |
| Executor         | Best code generation, longer outputs | Coding specialist             |
| Verify subgraph  | Understand code + run commands       | Coding specialist             |

With 48GB unified memory on M5 Pro, two models fit comfortably and can run simultaneously.

---

## Recommended Models

### Coding Model — Executor + Verify

**`Qwen3-Coder-30B-A3B-Instruct` (any MLX variant, I chose 4bit)**

- Score: 92 | Speed: 103 tok/s | Memory: ~15GB (32%) | Context: 262k
- MoE architecture: 30B total params, 3B active — fast despite large size
- Dedicated coding model, best code generation in the "Perfect fit" tier
- 262k context handles large codebases without truncation
- Pick quantization based on preference:
  - `MLX-4bit` — smallest, fastest, minimal quality loss for code
  - `MLX-6bit` — good balance (recommended)
  - `MLX-8bit` — best quality, ~18GB, still fits

### Fast Model — Explore + Plan

**`DeepSeek-R1-0528-Qwen3-8B` (MLX-8bit)**

- Score: 86 | Speed: 28.5 tok/s | Memory: ~17GB (36%) | Context: 131k
- Reasoning model — structured thinking for the plan node
- Reasoning can be toggled off for explore (faster, cheaper)
- 131k context handles exploration summaries and plans comfortably

**Combined memory: ~32GB (~68% of 48GB)** — runs comfortably in parallel, leaves headroom for the OS and terminal.

---

## Tradeoffs

### Why not Qwen3.5-35B-A3B (Score 94)?

Best single model in the list. At 38% memory (~18GB) you could fit a second model, but only a small one. If you want single-model simplicity, this is the pick. You lose the speed advantage on cheap calls and the coding specialization on executor.

### Why not Qwen3-Coder-Next (79.7B, Score 94)?

Best coding score, but 85% memory. No room for a second model. Would need to swap models between nodes, adding latency.

### Why not DeepSeek-Coder-V2-Lite (15.7B, Score 92)?

Same score as the 30B coder at 17% memory. Tempting. Lower quality on complex multi-file tasks — the 30B coder handles longer context edits better. Worth trying if you want to fit a higher-quality fast model.

### Why DeepSeek-R1-0528-Qwen3-8B over LFM2-24B-A2B?

LFM2 is faster (138 tok/s vs 28.5) but has no reasoning capability. The plan node needs structured reasoning — LFM2 would produce shallower plans. DeepSeek-R1-0528 is based on Qwen3-8B and supports a thinking toggle, so reasoning can be disabled for explore to recover speed.

---

## Model Serving

LM Studio is the serving layer. It uses MLX under the hood and exposes an OpenAI-compatible `/v1/chat/completions` endpoint. Model configuration (context length, sampling parameters, etc.) is done through the LM Studio GUI.

### Auto-download on launch

`apps/api/src/setup.ts` already handles this via the `lms` CLI (LM Studio's CLI tool). It needs to be updated to handle two models instead of one:

```typescript
// apps/api/src/setup.ts
const models = [
  { name: env.CODING_MODEL, purpose: 'executor + verify (code generation)' },
  { name: env.FAST_MODEL, purpose: 'explore + plan' },
]

for (const { name, purpose } of models) {
  await runLms(['get', name]) // downloads if not present, no-ops if already there
  await runLms(['load', name]) // loads into memory
}

await runLms(['server', 'start'])
```

The `lms` CLI is installed with LM Studio. On first launch it downloads both models; subsequent launches skip the download and go straight to load + serve.

**Prerequisite:** LM Studio must be installed. If `lms` is not in PATH, setup fails with a clear error — no silent fallback.

`setup()` is called as the first thing in `apps/cli/src/index.ts`, before the agent or session are initialized — so both single-shot CLI and interactive REPL go through it. See `05-terminal-refactor.md`.

---

## Env Config Changes

Current `apps/api/src/env.ts` has `CODING_MODEL`, `LM_STUDIO_API_URL`, `SUMMARIZATION_MODEL`, and `LANGGRAPH_API_URL`. Replace with two models and drop the fields that are going away (`SUMMARIZATION_MODEL` — title generation is removed in doc 04; `LANGGRAPH_API_URL` — the API server is removed in doc 05):

```typescript
// apps/api/src/env.ts
const envSchema = z.object({
  MODEL_API_BASE_URL: z.url(),
  // Coding model — executor, verify
  CODING_MODEL: z.string(),
  // Fast model — explore, plan
  FAST_MODEL: z.string(),

  LANGFUSE_PUBLIC_KEY: z.string(),
  LANGFUSE_SECRET_KEY: z.string(),
  LANGFUSE_BASE_URL: z.url(),
})
```

```bash
# .env
MODEL_API_BASE_URL=http://127.0.0.1:1234/v1
CODING_MODEL=qwen3-coder-30b-a3b-instruct-mlx-4bit
FAST_MODEL=deepseek-r1-0528-qwen3-8b-mlx-8bit

LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=http://localhost:3000
```

## Extend `ChatOpenAIWithReasoning` for Reasoning Effort

The current `ChatOpenAIWithReasoning` class only overrides token counting and delta parsing. DeepSeek R1 models support a `thinking` parameter at the request level to toggle reasoning. Add support for this:

```typescript
// apps/api/src/utils/chat-openai-with-reasoning.ts
import { ChatOpenAI } from '@langchain/openai'
import { AIMessageChunk } from '@langchain/core/messages'

type ReasoningEffort = 'off' | 'low' | 'high'

export class ChatOpenAIWithReasoning extends ChatOpenAI {
  reasoningEffort: ReasoningEffort

  constructor(
    fields: ConstructorParameters<typeof ChatOpenAI>[0] & { reasoningEffort?: ReasoningEffort }
  ) {
    super(fields)
    this.reasoningEffort = fields?.reasoningEffort ?? 'off'
  }

  override invocationParams(options?: any) {
    const params = super.invocationParams(options)
    if (this.reasoningEffort !== 'off') {
      // DeepSeek R1 models use `thinking` param to enable/control reasoning
      params.thinking = {
        type: 'enabled',
        budget_tokens: this.reasoningEffort === 'high' ? 8192 : 2048,
      }
    }
    return params
  }

  // ... keep existing shouldUseApproximateTokenCount, approximateTokenCount,
  // getNumTokens, and _convertOpenAIDeltaToBaseMessageChunk methods unchanged
}
```

Note: The exact parameter format depends on what LM Studio's OpenAI-compatible endpoint accepts for DeepSeek R1 models. You may need to adjust `invocationParams` after testing — try it with the model loaded and check what works.

## Model Instantiation

In `apps/api/src/graphs/agent.ts`, create both model instances and export a factory:

```typescript
export function createModels() {
  const codingModel = new ChatOpenAIWithReasoning({
    model: env.CODING_MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.3,
    streaming: true,
  })

  const fastModel = new ChatOpenAIWithReasoning({
    model: env.FAST_MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.1,
    streaming: false,
    reasoningEffort: 'low',
  })

  const planModel = new ChatOpenAIWithReasoning({
    model: env.FAST_MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.1,
    streaming: false,
    reasoningEffort: 'high',
  })

  return { codingModel, fastModel, planModel }
}
```

Export `createModels()` from this module. The models get wired to nodes in doc 04 (Graph Architecture) — do not connect them to the graph yet.
