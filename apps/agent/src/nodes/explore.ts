import { AIMessage } from '@langchain/core/messages'
import type { Runnable, RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

export function createExploreNode(exploreGraph: Runnable) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return {}

    const result = await exploreGraph.invoke({ messages: [lastUserMessage] }, config)

    const lastMessage = [...result.messages]
      .reverse()
      .find((m: { type: string }) => m.type === 'ai')
    const summary = lastMessage ? String(lastMessage.content) : ''

    return {
      exploreSummary: summary,
      messages: [
        new AIMessage({
          content: '',
          additional_kwargs: { phase_marker: 'explore', phase_event: 'start' },
        }),
        ...result.messages.slice(1), // skip the duplicated user message
        new AIMessage({
          content: '',
          additional_kwargs: { phase_marker: 'explore', phase_event: 'end' },
        }),
      ],
    }
  }
}
