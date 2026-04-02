import { AIMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import type { BaseMessage } from 'langchain'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import { getLangfuse } from '@/utils/langfuse'

export function createExecutorNode(
  modelWithTools: Runnable<Array<BaseMessage>>,
  modelName?: string
) {
  return async (
    state: AgentState,
    config: LangGraphRunnableConfig
  ): Promise<Partial<AgentState>> => {
    const conversationMessages = state.messages.filter(
      msg => !msg.additional_kwargs.progress_update
    )

    // Sanitize messages: convert any "generic" type messages (ChatMessage with no role)
    // to AIMessages to prevent OpenAI API format errors
    const messages = conversationMessages.map(msg =>
      msg.type === 'generic'
        ? new AIMessage({
            content: msg.content,
            id: msg.id,
            additional_kwargs: msg.additional_kwargs,
          })
        : msg
    )

    // Pass parent config through so streamEvents callbacks are preserved
    const response = await modelWithTools.invoke(messages, config)

    const reasoning =
      typeof response.additional_kwargs?.reasoning_content === 'string'
        ? response.additional_kwargs.reasoning_content
        : undefined

    const langfuse = getLangfuse()
    const threadId = config.configurable?.thread_id
    if (langfuse && threadId) {
      langfuse.trace({ id: threadId }).update({
        metadata: {
          ...(modelName && { model: modelName }),
          ...(reasoning && { reasoning }),
        },
      })
    }

    return { messages: [response] }
  }
}
