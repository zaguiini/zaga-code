import { SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'

const MAX_EXPLORE_ITERATIONS = 15

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration and planning specialist. Your job is to understand the codebase and produce an implementation plan — not to implement anything.

READ-ONLY MODE: You only have access to file search, file read, and grep tools. Do not attempt to create, edit, or delete files.

Rules:
- If a file or pattern doesn't exist, note it and move on. Never retry the same search more than once.
- Prefer grep and file_search over guessing file paths. If file_read fails, the file doesn't exist — don't try variations.
- You have a limited number of tool calls. Be strategic: search broadly first, then read specific files.
- Stop exploring once you have enough context to produce a plan. Perfection is not the goal.

When you have gathered enough information, stop calling tools and write:

1. A brief summary of findings (relevant files, patterns, constraints)
2. A numbered implementation plan:
   - Be specific about file paths and what changes
   - Keep it under 10 steps
   - No code, just the plan`

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

  if (lastMessage.type !== 'ai') return 'explore-cleanup'

  const rootToolCalls = (lastMessage as { tool_calls?: Array<unknown> }).tool_calls
  if (!Array.isArray(rootToolCalls) || rootToolCalls.length === 0) return 'explore-cleanup'

  const exploreToolResults = state.messages.filter(m => m.type === 'tool').length
  if (exploreToolResults >= MAX_EXPLORE_ITERATIONS) return 'explore-cleanup'

  return 'explore-tools'
}

/** Runs after explore loop ends. Extracts the summary+plan from the last explore AI message. */
export function createExploreCleanupNode() {
  return (state: AgentState): Partial<AgentState> => {
    const lastExploreAi = [...state.messages]
      .reverse()
      .find(m => m.type === 'ai' && m.additional_kwargs.phase === 'explore')
    const content = lastExploreAi ? String(lastExploreAi.content) : ''
    return { exploreSummary: content, plan: content }
  }
}
