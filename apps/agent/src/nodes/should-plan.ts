import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'

const GATE_PROMPT = `Does this request require understanding the codebase before acting?

Answer YES if:
- The task involves multiple files or unknown file locations
- It requires understanding existing patterns before implementing
- It's a non-trivial feature or refactor
- The scope is unclear from the request alone

Answer NO if:
- It's a question (what, why, how, show me, explain)
- It's a single obvious file change ("fix the typo in X", "add Y to Z")
- It's a follow-up on something already discussed
- It doesn't involve code changes

Reply with exactly one word: yes or no`

export function createShouldPlanNode(fastModel: BaseChatModel) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastUserMessage) return { shouldPlan: false }

    const response = await fastModel.invoke([
      new SystemMessage(GATE_PROMPT),
      new HumanMessage(
        typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content)
      ),
    ])

    const answer = String(response.content).trim().toLowerCase()
    return { shouldPlan: answer.startsWith('yes') }
  }
}
