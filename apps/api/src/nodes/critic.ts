import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'

const criticOutputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
})

const CRITIC_SYSTEM_PROMPT = (
  plan: string | null
) => `You are a code review critic evaluating whether a coding assistant fully completed the user's request.

Be practical. Approve if:
- The task is complete even if not perfect
- The approach is sound and accomplishes the goal
- Any code changes are syntactically correct and logically sound

Reject only if:
- The task is clearly incomplete (files mentioned but not changed, steps skipped)
- There are obvious bugs in generated code
- The response doesn't address the actual request

${plan ? `The assistant was following this plan:\n${plan}\n\n` : ''}Return your assessment as structured output.`

export function createCriticNode(model: BaseChatModel) {
  const structuredCritic = model.withStructuredOutput(criticOutputSchema)

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueAttempts } = state

    const humanMessages = messages.filter(m => m.getType() === 'human')
    const aiMessages = messages.filter(m => m.getType() === 'ai')

    const latestUserRequest = humanMessages.at(-1)
    const latestResponse = aiMessages.at(-1)

    try {
      const userContent =
        typeof latestUserRequest?.content === 'string'
          ? latestUserRequest.content
          : JSON.stringify(latestUserRequest?.content)

      const assistantContent =
        typeof latestResponse?.content === 'string'
          ? latestResponse.content
          : JSON.stringify(latestResponse?.content)

      const result = (await structuredCritic.invoke([
        { role: 'system', content: CRITIC_SYSTEM_PROMPT(plan) },
        {
          role: 'user',
          content: `User request:\n${userContent}\n\nAssistant response:\n${assistantContent}`,
        },
      ])) as { approved: boolean; feedback: string }

      return {
        critiqueAttempts: critiqueAttempts + 1,
        critiqueFeedback: result.approved ? null : result.feedback,
      }
    } catch {
      // On error, approve to avoid hanging the graph
      return {
        critiqueAttempts: critiqueAttempts + 1,
        critiqueFeedback: null,
      }
    }
  }
}

export function shouldRetry(state: AgentState): 'executor' | '__end__' {
  if (state.critiqueFeedback !== null && state.critiqueAttempts <= 2) {
    return 'executor'
  }
  return '__end__'
}
