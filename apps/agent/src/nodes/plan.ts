import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

const PLAN_SYSTEM_PROMPT = `You are an implementation planner. Produce a concise, numbered implementation plan.

Format:
1. [specific action] in [specific file]
2. [specific action] in [specific file]
...

Rules:
- Be specific about file paths and what changes
- Keep it under 10 steps
- No code, just the plan
- If the task is a question or doesn't require changes, write "No implementation needed — this is an informational request"`

export function createPlanNode(model: BaseChatModel) {
  return async (state: AgentState, config?: RunnableConfig): Promise<Partial<AgentState>> => {
    dispatchCustomEvent('phase_start', { phase: 'plan' }, config)

    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) {
      dispatchCustomEvent('phase_end', { phase: 'plan' }, config)
      return {}
    }

    const contextParts = [String(lastUserMessage.content)]
    if (state.exploreSummary) {
      contextParts.unshift(`Exploration findings:\n${state.exploreSummary}\n\nUser request:`)
    }

    const response = await model.invoke([
      new SystemMessage(PLAN_SYSTEM_PROMPT),
      new HumanMessage(contextParts.join(' ')),
    ])

    dispatchCustomEvent('phase_end', { phase: 'plan' }, config)
    return { plan: String(response.content) }
  }
}
