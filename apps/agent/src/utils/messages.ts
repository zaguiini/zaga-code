import type { BaseMessage } from '@langchain/core/messages'

/** Find the last human message in a message array. */
export function getLastHumanMessage(messages: Array<BaseMessage>): BaseMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'human') return messages[i]
  }
  return undefined
}

/** Extract the text content from a message, handling both string and array formats. */
export function getMessageText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter((c): c is { type: 'text'; text: string } => 'text' in c)
      .map(c => c.text)
      .join('')
  }
  return String(message.content)
}
