import type { RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

/** Runs after the explore subgraph completes. Extracts the summary. */
export function createExploreCleanupNode() {
  return (state: AgentState, _config: RunnableConfig): Partial<AgentState> => {
    const lastAiMessage = [...state.messages]
      .reverse()
      .find(m => m.type === 'ai' && m.additional_kwargs.phase === 'explore')
    const summary = lastAiMessage ? String(lastAiMessage.content) : ''

    return { exploreSummary: summary }
  }
}
