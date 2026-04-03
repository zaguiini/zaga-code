import { SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'

const MAX_EXPLORE_ITERATIONS = 15

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration specialist. Your job is to gather information — not to implement anything.

READ-ONLY MODE: You only have access to file search, file read, and grep tools. Do not attempt to create, edit, or delete files.

Rules:
- If a file or pattern doesn't exist, note it and move on. Never retry the same search more than once.
- Prefer grep and file_search over guessing file paths. If file_read fails, the file doesn't exist — don't try variations.
- You have a limited number of tool calls. Be strategic: search broadly first, then read specific files.
- Stop exploring once you have enough context to suggest an approach. Perfection is not the goal.

When you have gathered enough information, stop calling tools and write a structured summary:
- Relevant files and their purposes
- Existing patterns to follow
- Potential gotchas or constraints
- Suggested approach (high level only)

Be thorough but efficient. The plan node will use your summary to produce an implementation plan.`

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

    const start = Date.now()
    const response = await modelWithTools.invoke(messages, config)
    const durationMs = Date.now() - start
    const hasReasoning = typeof response.additional_kwargs.reasoning_content === 'string'
    response.additional_kwargs = {
      ...response.additional_kwargs,
      phase: 'explore',
      ...(hasReasoning && { reasoning_duration_ms: durationMs }),
    }
    return { messages: [response] }
  }
}

/** Conditional edge for the explore loop — stops after MAX_EXPLORE_ITERATIONS. */
export function exploreToolsCondition(state: AgentState): 'explore-tools' | 'explore-cleanup' {
  const lastMessage = state.messages[state.messages.length - 1]

  // If the last AI message has no tool calls, exploration is done
  if (lastMessage.type !== 'ai') return 'explore-cleanup'
  const hasToolCalls =
    Array.isArray(lastMessage.additional_kwargs.tool_call_chunks) &&
    lastMessage.additional_kwargs.tool_call_chunks.length > 0
  if (!hasToolCalls) return 'explore-cleanup'

  // Count explore-phase tool results as a proxy for iterations
  const exploreToolResults = state.messages.filter(
    m =>
      m.type === 'tool' &&
      state.messages.some(a => a.type === 'ai' && a.additional_kwargs.phase === 'explore')
  ).length

  if (exploreToolResults >= MAX_EXPLORE_ITERATIONS) return 'explore-cleanup'

  return 'explore-tools'
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
