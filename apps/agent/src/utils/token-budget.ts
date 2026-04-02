import type { BaseMessage } from '@langchain/core/messages'

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function estimateMessagesTokens(messages: Array<BaseMessage>): number {
  return messages.reduce((total, msg) => {
    const content =
      typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text ?? '').join('')
    return total + estimateTokens(content)
  }, 0)
}

export function contextFillRatio(messages: Array<BaseMessage>, maxTokens: number): number {
  return estimateMessagesTokens(messages) / maxTokens
}
