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

/** Get messages belonging to a specific phase, filtering out empty AI responses. */
export function getPhaseMessages(messages: Array<BaseMessage>, phase: string): Array<BaseMessage> {
  return messages.filter(m => {
    if (m.type === 'tool') return true
    if (m.additional_kwargs.phase !== phase) return false
    const hasContent = String(m.content).trim().length > 0
    const hasCalls =
      Array.isArray((m as { tool_calls?: Array<unknown> }).tool_calls) &&
      ((m as { tool_calls?: Array<unknown> }).tool_calls?.length ?? 0) > 0
    return hasContent || hasCalls
  })
}

/** Count consecutive empty AI responses with a given phase tag at the end of messages. */
export function countTrailingEmptyResponses(messages: Array<BaseMessage>, phase: string): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== 'ai' || m.additional_kwargs.phase !== phase) break
    if (String(m.content).trim() === '') count++
    else break
  }
  return count
}
