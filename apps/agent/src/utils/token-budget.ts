import type { BaseMessage } from '@langchain/core/messages'

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Rough overhead for tool schemas registered with the model (per conversation). */
const TOOL_SCHEMA_OVERHEAD = 1500

function estimateMessageTokens(msg: BaseMessage): number {
  // Main content
  const content =
    typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text ?? '').join('')
  let tokens = estimateTokens(content)

  // Reasoning content (extended thinking)
  const reasoning = msg.additional_kwargs.reasoning_content
  if (typeof reasoning === 'string') {
    tokens += estimateTokens(reasoning)
  }

  // Tool call arguments
  const toolCalls = (msg as { tool_calls?: Array<{ args?: Record<string, unknown> }> }).tool_calls
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (tc.args) tokens += estimateTokens(JSON.stringify(tc.args))
    }
  }

  return tokens
}

export function estimateMessagesTokens(messages: Array<BaseMessage>): number {
  return (
    messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0) + TOOL_SCHEMA_OVERHEAD
  )
}

export function contextFillRatio(
  messages: Array<BaseMessage>,
  maxTokens: number,
  usedTokens?: number
): number {
  // Prefer actual token count from API when available
  if (usedTokens && usedTokens > 0) return usedTokens / maxTokens
  return estimateMessagesTokens(messages) / maxTokens
}

/**
 * Extract prompt_tokens from a model response's response_metadata.
 * ChatOpenAI populates this from the API's usage field.
 */
export function extractPromptTokens(response: BaseMessage): number {
  const metadata = response.response_metadata as Record<string, unknown> | undefined
  if (!metadata) return 0

  // Raw OpenAI format (used by LM Studio / streaming mode)
  const usage = metadata.usage as { prompt_tokens?: number } | undefined
  if (usage?.prompt_tokens) return usage.prompt_tokens

  // LangChain's transformed format (non-streaming mode)
  const tokenUsage = metadata.tokenUsage as { promptTokens?: number } | undefined
  return tokenUsage?.promptTokens ?? 0
}
