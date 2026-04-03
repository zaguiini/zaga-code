import { ToolMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'
import { createPhaseCondition, createPhasedExecutor } from '@/nodes/phased-executor'

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

export function createExploreExecutorNode(
  model: BaseChatModel,
  readOnlyTools: Array<StructuredToolInterface>
) {
  return createPhasedExecutor(model, readOnlyTools, {
    phase: 'explore',
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    buildUserPrompt: (userText, state) => {
      const exploreCall = findExploreToolCall(state.messages)
      return exploreCall?.args.prompt ?? userText
    },
  })
}

export const exploreToolsCondition = createPhaseCondition({
  phase: 'explore',
  maxIterations: 15,
  maxEmptyRetries: 3,
  toolsNode: 'explore-tools',
  executorNode: 'explore-executor',
  exitNode: 'explore-result',
})

/** Find the most recent AI message that contains an explore tool call. */
function findExploreToolCall(messages: Array<BaseMessage>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.type !== 'ai') continue
    const toolCalls = (msg as AIMessage).tool_calls
    const exploreCall = toolCalls?.find(tc => tc.name === 'explore')
    if (exploreCall) return exploreCall
  }
  return undefined
}

/**
 * Runs after the explore loop finishes. Takes the explore phase's final output
 * and wraps it as a ToolMessage so the main executor sees it as a tool result.
 */
export function createExploreResultNode() {
  return (state: AgentState): Partial<AgentState> => {
    const exploreCall = findExploreToolCall(state.messages)
    if (!exploreCall?.id) return {}

    // Find the last explore-phase AI message with content (the plan)
    const lastExploreAi = [...state.messages]
      .reverse()
      .find(
        m => m.type === 'ai' && m.additional_kwargs.phase === 'explore' && String(m.content).trim()
      )

    const content = lastExploreAi
      ? String(lastExploreAi.content)
      : 'Exploration complete — no findings.'

    return {
      messages: [new ToolMessage({ content, tool_call_id: exploreCall.id })],
    }
  }
}
