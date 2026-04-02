// apps/api/src/nodes/explore.ts
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'

export function createExploreNode(exploreGraph: CompiledStateGraph) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return {}

    const result = await exploreGraph.invoke({
      messages: [lastUserMessage],
    })

    const lastMessage = [...result.messages].reverse().find((m: { type: string }) => m.type === 'ai')
    const summary = lastMessage ? String(lastMessage.content) : ''

    return { exploreSummary: summary }
  }
}
