import { z } from 'zod'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const classifierOutputSchema = z.object({
  complexity: z.enum(['simple', 'medium', 'complex']),
  planningDepth: z.enum(['brief', 'detailed', 'decomposed']),
})

const CLASSIFIER_SYSTEM_PROMPT = `You are a task classifier for a coding assistant. Given a user's coding request, classify its complexity and determine the appropriate planning depth.

Complexity levels:
- simple: explain code, answer questions, read and summarize files (most tasks)
- medium: debug issues, make targeted changes to one or a few related files
- complex: implement new features, refactor across multiple files, architectural changes

Planning depth mirrors complexity:
- brief (for simple): 2-3 steps — which files to read, what to answer
- detailed (for medium): numbered steps — files to inspect, changes to make, order of operations
- decomposed (for complex): sub-tasks with dependencies spelled out

Return only the classification. Do not explain.`

export function createClassifierNode(model: BaseChatModel) {
  const structuredClassifier = model.withStructuredOutput(classifierOutputSchema, {
    includeRaw: true,
  })

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const firstHumanMessage = state.messages.find(m => m.type === 'human')

    if (!firstHumanMessage) {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }

    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId)

    try {
      const userContent =
        typeof firstHumanMessage.content === 'string'
          ? firstHumanMessage.content
          : JSON.stringify(firstHumanMessage.content)

      const { raw, parsed } = (await structuredClassifier.invoke(
        [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        { callbacks: [handler] }
      )) as {
        raw: any
        parsed: {
          complexity: 'simple' | 'medium' | 'complex'
          planningDepth: 'brief' | 'detailed' | 'decomposed'
        }
      }

      const modelName = (model as any).model as string | undefined
      const reasoning =
        typeof raw?.additional_kwargs?.reasoning_content === 'string'
          ? raw.additional_kwargs.reasoning_content
          : undefined

      if (handler.traceId) {
        langfuse.trace({ id: handler.traceId }).update({
          metadata: {
            complexity: parsed.complexity,
            planningDepth: parsed.planningDepth,
            ...(modelName && { model: modelName }),
            ...(reasoning && { reasoning }),
          },
        })
      }

      return parsed
    } catch {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }
  }
}
