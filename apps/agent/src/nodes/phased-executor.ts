import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import {
  countTrailingEmptyResponses,
  getLastHumanMessage,
  getMessageText,
  getPhaseMessages,
} from '@/utils/messages'
import { extractPromptTokens } from '@/utils/token-budget'

interface PhasedExecutorOptions {
  phase: string
  systemPrompt: string
  /** How to build the user-facing prompt from the last human message text and current state. */
  buildUserPrompt: (userText: string, state: AgentState) => string
}

/**
 * Creates a phased executor node that runs within the main graph.
 * Creates a phased executor node that runs within the main graph — invoke model with a system prompt,
 * filter phase messages, tag responses with phase metadata.
 */
export function createPhasedExecutor(
  model: BaseChatModel,
  tools: Array<StructuredToolInterface>,
  options: PhasedExecutorOptions
) {
  const modelWithTools = model.bindTools!(tools)

  return async (
    state: AgentState,
    config: LangGraphRunnableConfig
  ): Promise<Partial<AgentState>> => {
    const lastHuman = getLastHumanMessage(state.messages)
    const userText = lastHuman ? getMessageText(lastHuman) : 'unknown'

    const lastHumanIdx = lastHuman ? state.messages.lastIndexOf(lastHuman) : 0
    const afterHuman = state.messages.slice(lastHumanIdx + 1)
    const phaseMessages = getPhaseMessages(afterHuman, options.phase)

    const userPrompt = options.buildUserPrompt(userText, state)

    const messages = [
      new SystemMessage(options.systemPrompt),
      new HumanMessage(userPrompt),
      ...phaseMessages,
    ]

    const start = Date.now()
    const response = await modelWithTools.invoke(messages, config)
    const durationMs = Date.now() - start
    const hasReasoning = typeof response.additional_kwargs.reasoning_content === 'string'
    response.additional_kwargs = {
      ...response.additional_kwargs,
      phase: options.phase,
      ...(hasReasoning && { reasoning_duration_ms: durationMs }),
    }
    const usedTokens = extractPromptTokens(response)
    return { messages: [response], ...(usedTokens > 0 && { usedTokens }) }
  }
}

interface PhaseConditionOptions {
  phase: string
  maxIterations: number
  maxEmptyRetries: number
  /** Node name for the tools node in this phase. */
  toolsNode: string
  /** Node name for the executor node in this phase. */
  executorNode: string
  /** Node to transition to when the phase is done. */
  exitNode: string
}

/**
 * Creates a conditional edge function for a phased tool loop.
 * Handles: tool calls → tools node, meaningful content → exit, empty retries → exit.
 */
export function createPhaseCondition(options: PhaseConditionOptions) {
  return (state: AgentState): string => {
    const lastMessage = state.messages[state.messages.length - 1]

    if (lastMessage.type !== 'ai') return options.exitNode

    // Count only tool results from this phase
    const phaseToolResults = state.messages.filter(
      m =>
        m.type === 'tool' &&
        state.messages.some(a => a.type === 'ai' && a.additional_kwargs.phase === options.phase)
    ).length
    if (phaseToolResults >= options.maxIterations) return options.exitNode

    const rootToolCalls = (lastMessage as { tool_calls?: Array<unknown> }).tool_calls
    if (Array.isArray(rootToolCalls) && rootToolCalls.length > 0) return options.toolsNode

    const content = String(lastMessage.content).trim()
    if (content.length > 0) return options.exitNode

    const emptyCount = countTrailingEmptyResponses(state.messages, options.phase)
    if (emptyCount >= options.maxEmptyRetries) return options.exitNode

    return options.executorNode
  }
}
