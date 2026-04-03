import { SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration specialist. Your job is to gather information — not to implement anything.

READ-ONLY MODE: You only have access to file search, file read, and grep tools. Do not attempt to create, edit, or delete files.

When you have gathered enough information, stop calling tools and write a structured summary:
- Relevant files and their purposes
- Existing patterns to follow
- Potential gotchas or constraints
- Suggested approach (high level only)

Be thorough. The plan node will use your summary to produce an implementation plan.`

/** Explore executor node — runs inline in the main graph for real-time streaming. */
export function createExploreExecutorNode(
  model: BaseChatModel,
  readOnlyTools: Array<StructuredToolInterface>
) {
  const modelWithTools = model.bindTools!(readOnlyTools)

  return async (
    state: AgentState,
    config: LangGraphRunnableConfig
  ): Promise<Partial<AgentState>> => {
    const lastHuman = [...state.messages].reverse().find(m => m.type === 'human')
    const lastHumanIdx = lastHuman ? state.messages.lastIndexOf(lastHuman) : 0
    const afterHuman = state.messages.slice(lastHumanIdx + 1)

    // Collect explore-phase continuation messages (previous explore AI + tool results)
    const phaseMessages = afterHuman.filter(
      m =>
        m.additional_kwargs.phase === 'explore' ||
        (m.type === 'tool' && afterHuman.some(a => a.additional_kwargs.phase === 'explore'))
    )

    const messages = [new SystemMessage(EXPLORE_SYSTEM_PROMPT), lastHuman!, ...phaseMessages]

    const response = await modelWithTools.invoke(messages, config)
    response.additional_kwargs = { ...response.additional_kwargs, phase: 'explore' }
    return { messages: [response] }
  }
}

/** Runs after explore loop ends. Extracts the summary from the last explore AI message. */
export function createExploreCleanupNode() {
  return (state: AgentState): Partial<AgentState> => {
    const lastExploreAi = [...state.messages]
      .reverse()
      .find(m => m.type === 'ai' && m.additional_kwargs.phase === 'explore')
    const summary = lastExploreAi ? String(lastExploreAi.content) : ''
    return { exploreSummary: summary }
  }
}
