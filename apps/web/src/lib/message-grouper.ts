import type { Message, ToolProgress } from '@langchain/langgraph-sdk'
import type { Message as MessageType, ToolInvocationPart } from '@/components/ui/chat-message'

export function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content.trim()
  return content
    .filter(c => c.type === 'text' && c.text !== undefined)
    .map(c => c.text ?? '')
    .join('')
    .trim()
}

export const messageGrouper = (
  messages: Array<Message>,
  toolProgress: Record<string, ToolProgress>
): Array<MessageType> => {
  // Build a map of tool results keyed by tool_call_id
  const toolResults = new Map<string, string>()
  for (const msg of messages) {
    if (msg.type === 'tool' && msg.tool_call_id) {
      toolResults.set(msg.tool_call_id, extractText(msg.content))
    }
  }

  return messages
    .filter(msg => msg.type !== 'tool')
    .flatMap((msg): Array<MessageType> => {
      const id = msg.id ?? Math.random().toString(36).slice(2)

      if (msg.type !== 'ai') {
        return [
          {
            id,
            role: msg.type === 'human' ? 'user' : 'assistant',
            content: extractText(msg.content),
          },
        ]
      }

      // AI / assistant message
      const result: Array<MessageType> = []

      const reasoningContent = msg.additional_kwargs?.reasoning_content as string | undefined
      if (reasoningContent?.trim()) {
        const durationMs = msg.additional_kwargs?.reasoning_duration_ms as number | undefined
        result.push({
          id,
          role: 'assistant',
          content: reasoningContent,
          parts: [
            {
              type: 'reasoning',
              reasoning: reasoningContent,
              durationMs,
              done: durationMs !== undefined,
            },
          ],
        })
      }

      const messageContent = extractText(msg.content)
      if (messageContent) {
        result.push({
          id,
          role: 'assistant',
          content: messageContent,
          parts: [{ type: 'text', text: messageContent }],
        })
      }

      const toolCalls = msg.tool_calls ?? []
      if (toolCalls.length > 0) {
        result.push(
          ...toolCalls.map(toolCall => {
            const parts: Array<ToolInvocationPart> = []
            const resultContent = toolResults.get(toolCall.id!)

            if (resultContent !== undefined) {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'result',
                  args: toolCall.args,
                  result: resultContent,
                },
              })
            }

            const progress = toolCall.id! in toolProgress ? toolProgress[toolCall.id!] : undefined
            if (
              progress !== undefined &&
              (progress.state === 'running' || progress.state === 'starting')
            ) {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'streaming',
                  args: toolCall.args,
                  data: progress.input,
                },
              })
            } else if (resultContent === undefined) {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'call',
                  args: toolCall.args,
                },
              })
            }

            return {
              id: toolCall.id!,
              role: 'assistant' as const,
              content: '',
              parts,
            }
          })
        )
      }

      return result
    })
}
