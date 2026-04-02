import { RemoveMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { contextFillRatio } from '@/utils/token-budget'
import { summarizeMessages } from '@/utils/summarize'
import { env } from '@/env'

const COMPACT_THRESHOLD = 0.85
const KEEP_RECENT = 10

export function createMaybeCompactNode(fastModel: BaseChatModel) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const maxTokens = Number(env.CODING_MODEL_MAX_TOKENS)
    const ratio = contextFillRatio(state.messages, maxTokens)

    if (ratio < COMPACT_THRESHOLD && !state.forceCompact) return {}

    const cutoff = Math.max(0, state.messages.length - KEEP_RECENT)
    const toSummarize = state.messages.slice(0, cutoff)

    if (toSummarize.length === 0) return { forceCompact: false }

    const summary = await summarizeMessages(toSummarize, fastModel)

    const removals = toSummarize.map(m => new RemoveMessage({ id: m.id! }))
    return { messages: [...removals, summary], forceCompact: false }
  }
}
