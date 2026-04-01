# 03 — Context Management

## The Problem

Long sessions silently degrade. The LLM has a finite context window. When you approach it:

- Local models (LM Studio / MLX) return a vague error or silently truncate
- Quality drops before the hard limit — the model "forgets" earlier parts of the session
- There's no recovery without manually starting a new session

LFM2-24B has 128k context. Qwen3-Coder-30B has 262k. At ~4 chars/token, that's ~512k characters for the coder. A realistic long session (many tool calls with full file contents) hits this in 30-60 minutes of heavy use.

---

## Token Counting

`ChatOpenAIWithReasoning` already approximates tokens as `ceil(text.length / 4)` for non-OpenAI models. That's good enough for budget tracking.

Add a utility to count the current message history:

```typescript
// apps/api/src/utils/token-budget.ts

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessagesTokens(messages: BaseMessage[]): number {
  return messages.reduce((total, msg) => {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((c: any) => c.text ?? '').join('')
    return total + estimateTokens(content)
  }, 0)
}

// Return a value from 0 to 1 representing how full the context is
export function contextFillRatio(messages: BaseMessage[], maxTokens: number): number {
  return estimateMessagesTokens(messages) / maxTokens
}
```

---

## When to Trigger Summarization

Two thresholds:

| Threshold          | Action                               |
| ------------------ | ------------------------------------ |
| > 70% context used | Warn in terminal, suggest `/compact` |
| > 85% context used | Auto-summarize oldest messages       |

Auto-summarization at 85% prevents hard failures. The 70% warning gives the user a chance to compact manually before quality degrades.

---

## Summarization Strategy

Don't summarize the entire history — keep the most recent messages intact (the model needs recent context to continue coherently). Summarize the oldest chunk.

```typescript
// apps/api/src/utils/summarize.ts
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

const SUMMARIZE_PROMPT = `Summarize the following conversation segment. Preserve:
- What files were read or modified and how
- Key decisions made
- Current state of any in-progress work
- Any errors encountered and how they were resolved

Be specific about file paths and content. This summary will replace the original messages.`

export async function summarizeMessages(
  messages: BaseMessage[],
  fastModel: BaseChatModel
): Promise<AIMessage> {
  const text = messages
    .map(m => `${m.type}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n')

  const response = await fastModel.invoke([
    new SystemMessage(SUMMARIZE_PROMPT),
    new HumanMessage(text),
  ])

  return new AIMessage({
    content: `[Conversation summary]\n${response.content}`,
  })
}
```

---

## Compaction Node

Add a `maybe-compact` node that runs at the start of each turn, before `explore`.

The parent `state.messages` only grows through `executor ⇄ tools` cycles — the explore and plan phases run as isolated subgraphs with their own message arrays and don't contribute to parent state. So the right moment to compact is at the top of each new user turn, after the previous turn's executor loop has finished accumulating messages but before the next round begins. Compacting before `explore` (rather than before `executor`) ensures the explore subgraph receives a clean prompt with the task context, not a bloated history it doesn't need.

```typescript
// nodes/maybe-compact.ts
import { RemoveMessage } from '@langchain/core/messages'
import { contextFillRatio } from '@/utils/token-budget'
import { summarizeMessages } from '@/utils/summarize'
import { env } from '@/env'

const COMPACT_THRESHOLD = 0.85
// Keep the last N messages unsummarized — recent context is most important
const KEEP_RECENT = 10

export function createMaybeCompactNode(fastModel: BaseChatModel) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const maxTokens = Number(env.CODING_MODEL_MAX_TOKENS)
    const ratio = contextFillRatio(state.messages, maxTokens)

    // Compact if context is nearly full OR if the user explicitly requested it
    if (ratio < COMPACT_THRESHOLD && !state.forceCompact) return {}

    // Split: summarize old messages, keep recent ones intact
    const cutoff = Math.max(0, state.messages.length - KEEP_RECENT)
    const toSummarize = state.messages.slice(0, cutoff)

    if (toSummarize.length === 0) return { forceCompact: false }

    const summary = await summarizeMessages(toSummarize, fastModel)

    // IMPORTANT: MessagesAnnotation uses an additive reducer — returning messages
    // appends them, it doesn't replace. Use RemoveMessage to delete old messages
    // first, then add the summary.
    const removals = toSummarize.map(m => new RemoveMessage({ id: m.id! }))
    return { messages: [...removals, summary], forceCompact: false }
  }
}
```

The `createMaybeCompactNode` function is exported from this file. It gets wired into the graph in doc 04 (Graph Architecture) as:

```typescript
.addEdge(START, 'maybe-compact')
.addEdge('maybe-compact', 'should-plan')
```

Do NOT modify `graphs/agent.ts` graph wiring here — that integration happens in doc 04.

---

## Env Config

Add model context limits to env so they're easy to adjust:

```bash
CODING_MODEL_MAX_TOKENS=262000
FAST_MODEL_MAX_TOKENS=128000
```

Use `CODING_MODEL_MAX_TOKENS` in the compaction check. If you switch to a smaller model, update the env and compaction triggers automatically.

---

## What This Doesn't Cover

- **Tool output truncation** — large file reads and shell output can blow up context in a single turn. Add a `MAX_TOOL_OUTPUT` character limit (e.g. 20k chars) in each tool and truncate with a note. This is a quick add to each tool's return value.
- **Selective message dropping** — instead of summarizing, you could drop old tool result messages (which are often the largest). Simpler to implement but loses more context.
- **Per-model limits** — the fast model (128k) hits limits faster than the coding model (262k). Since explore/plan use the fast model with their own context, this is less of an issue — subgraphs get fresh context per invocation.
