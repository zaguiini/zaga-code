import { AIMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from 'langchain'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import { getLangfuse } from '@/utils/langfuse'
import { extractPromptTokens } from '@/utils/token-budget'
import { toolRegistry } from '@/config/registry'

export function createExecutorNode(model: BaseChatModel, modelName?: string) {
  return async (
    state: AgentState,
    config: LangGraphRunnableConfig
  ): Promise<Partial<AgentState>> => {
    const tools = toolRegistry.get(state.configHash)
    if (!tools) {
      throw new Error(`[executor] No tools registered for configHash: ${state.configHash}`)
    }
    const modelWithTools = model.bindTools!(tools)

    const conversationMessages = state.messages.filter(
      msg => !msg.additional_kwargs.progress_update && !msg.additional_kwargs.phase
    )

    // Sanitize messages: convert any "generic" type messages (ChatMessage with no role)
    // to AIMessages to prevent OpenAI API format errors
    const messages = conversationMessages.map((msg: BaseMessage) =>
      msg.type === 'generic'
        ? new AIMessage({
            content: msg.text,
            id: msg.id,
            additional_kwargs: msg.additional_kwargs,
          })
        : msg
    )

    // Pass parent config through so streamEvents callbacks are preserved
    const start = Date.now()
    const response = await modelWithTools.invoke(messages, config)
    const durationMs = Date.now() - start

    const reasoning =
      typeof response.additional_kwargs.reasoning_content === 'string'
        ? response.additional_kwargs.reasoning_content
        : undefined

    if (reasoning) {
      response.additional_kwargs = {
        ...response.additional_kwargs,
        reasoning_duration_ms: durationMs,
      }
    }

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

    const usedTokens = extractPromptTokens(response)

    return { messages: [response], ...(usedTokens > 0 && { usedTokens }) }
  }
}
