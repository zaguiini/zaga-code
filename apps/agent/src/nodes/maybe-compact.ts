import { RemoveMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { contextFillRatio } from '@/utils/token-budget'
import { summarizeMessages } from '@/utils/summarize'

const COMPACT_THRESHOLD = 0.85
const KEEP_RECENT = 10

export function createMaybeCompactNode(model: BaseChatModel) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (state.maxTokens <= 0) return {}

    const ratio = contextFillRatio(state.messages, state.maxTokens, state.usedTokens)

    if (ratio < COMPACT_THRESHOLD) return {}

    const cutoff = Math.max(0, state.messages.length - KEEP_RECENT)
    const toSummarize = state.messages.slice(0, cutoff)

    if (toSummarize.length === 0) return {}

    const summary = await summarizeMessages(toSummarize, model)

    const removals = toSummarize.map(m => new RemoveMessage({ id: m.id! }))
    return { messages: [...removals, summary] }
  }
}
