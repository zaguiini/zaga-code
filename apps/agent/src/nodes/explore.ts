import type { Runnable, RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

/**
 * Streams the explore subgraph, forwarding config so events propagate
 * to the parent stream. Returns messages to parent state for grouping.
 */
export function createExploreNode(exploreGraph: Runnable) {
  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return {}

    // Debug: check if parent stream is in config
    const configurable = config.configurable as Record<string, unknown> | undefined
    const hasStream = Boolean(configurable?.__pregel_stream)
    console.log('[explore] config has __pregel_stream:', hasStream)

    const result = await exploreGraph.invoke({ messages: [lastUserMessage] }, config)

    const lastMessage = [...result.messages]
      .reverse()
      .find((m: { type: string }) => m.type === 'ai')
    const summary = lastMessage ? String(lastMessage.content) : ''

    // Tag messages with phase and return to parent state
    for (const msg of result.messages.slice(1)) {
      if (msg.additional_kwargs) {
        msg.additional_kwargs = { ...msg.additional_kwargs, phase: 'explore' }
      }
    }

    return { exploreSummary: summary, messages: result.messages.slice(1) }
  }
}
