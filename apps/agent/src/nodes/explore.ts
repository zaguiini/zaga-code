import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch'
import type { Runnable, RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

export function createExploreNode(exploreGraph: Runnable) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    await dispatchCustomEvent('phase_start', { phase: 'explore' }, config)

    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) {
      await dispatchCustomEvent('phase_end', { phase: 'explore' }, config)
      return {}
    }

    const result = await exploreGraph.invoke({ messages: [lastUserMessage] }, config)

    const lastMessage = [...result.messages]
      .reverse()
      .find((m: { type: string }) => m.type === 'ai')
    const summary = lastMessage ? String(lastMessage.content) : ''

    await dispatchCustomEvent('phase_end', { phase: 'explore' }, config)
    return { exploreSummary: summary }
  }
}
