import { RemoveMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'
import { contextFillRatio } from '@/utils/token-budget'
import { summarizeMessages } from '@/utils/summarize'
import { getModel } from '@/utils/get-model'

const COMPACT_THRESHOLD = 0.85
const KEEP_RECENT = 10

export async function maybeCompactNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.maxTokens <= 0) return {}

  const ratio = contextFillRatio(state.messages, state.maxTokens, state.usedTokens)

  if (ratio < COMPACT_THRESHOLD) return {}

  const cutoff = Math.max(0, state.messages.length - KEEP_RECENT)
  const toSummarize = state.messages.slice(0, cutoff)

  if (toSummarize.length === 0) return {}

  const model = getModel()

  const summary = await summarizeMessages(toSummarize, model)

  const removals = toSummarize.map(m => new RemoveMessage({ id: m.id! }))
  return { messages: [...removals, summary] }
}
