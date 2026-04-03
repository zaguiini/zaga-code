import { RemoveMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { contextFillRatio } from '@/utils/token-budget'
import { summarizeMessages } from '@/utils/summarize'

const COMPACT_THRESHOLD = 0.85
const KEEP_RECENT = 10

export function createMaybeCompactNode(model: BaseChatModel, maxTokens: number) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const ratio = contextFillRatio(state.messages, maxTokens, state.usedTokens)

    if (ratio < COMPACT_THRESHOLD) return { maxTokens }

    const cutoff = Math.max(0, state.messages.length - KEEP_RECENT)
    const toSummarize = state.messages.slice(0, cutoff)

    if (toSummarize.length === 0) return { maxTokens }

    const summary = await summarizeMessages(toSummarize, model)

    const removals = toSummarize.map(m => new RemoveMessage({ id: m.id! }))
    return { messages: [...removals, summary], maxTokens }
  }
}
