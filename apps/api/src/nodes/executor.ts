import { AIMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import type { BaseMessage, Runtime } from 'langchain'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

export function createExecutorNode(
  modelWithTools: Runnable<Array<BaseMessage>>,
  modelName?: string
) {
  return async (state: AgentState, runtime: Runtime): Promise<Partial<AgentState>> => {
    // Sanitize messages: convert any "generic" type messages (ChatMessage with no role)
    // to AIMessages to prevent OpenAI API format errors
    const messages = state.messages.map(msg =>
      msg.type === 'generic'
        ? new AIMessage({
            content: msg.content,
            id: msg.id,
            additional_kwargs: msg.additional_kwargs,
          })
        : msg
    )

    const threadId = runtime.configurable?.thread_id
    const handler = createCallbackHandler(threadId)

    const response = await modelWithTools.invoke(messages, { callbacks: [handler] })

    const reasoning =
      typeof response.additional_kwargs?.reasoning_content === 'string'
        ? response.additional_kwargs.reasoning_content
        : undefined

    if (handler.traceId && (modelName || reasoning)) {
      langfuse.trace({ id: handler.traceId }).update({
        metadata: {
          ...(modelName && { model: modelName }),
          ...(reasoning && { reasoning }),
        },
      })
    }

    return { messages: [response] }
  }
}
