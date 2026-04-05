import type { ToolProgress } from '@/hooks/streamReducer'
import type { Message as MessageType, ToolInvocationPart } from '@/components/ui/chat-message'

type RawMessage = {
  id?: string
  type: string
  content: string | Array<{ type: string; text?: string }>
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>
  additional_kwargs?: {
    reasoning_content?: string
    reasoning_duration_ms?: number
  }
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content
    .filter(c => c.type === 'text' && c.text !== undefined)
    .map(c => c.text ?? '')
    .join('')
}

export const messageGrouper = (
  messages: Array<unknown>,
  toolProgress: Record<string, ToolProgress>
): Array<MessageType> => {
  const raw = messages as Array<RawMessage>

  // Build a map of tool results keyed by tool_call_id
  const toolResults = new Map<string, string>()
  for (const msg of raw) {
    if (msg.type === 'tool' && msg.id) {
      toolResults.set(msg.id, extractText(msg.content))
    }
  }

  return raw
    .filter(msg => msg.type !== 'tool')
    .flatMap((msg): Array<MessageType> => {
      const id = msg.id ?? Math.random().toString(36).slice(2)

      if (msg.type === 'human') {
        return [
          {
            id,
            role: 'user',
            content: extractText(msg.content),
          },
        ]
      }

      // AI / assistant message
      const result: Array<MessageType> = []

      const reasoningContent = msg.additional_kwargs?.reasoning_content
      if (reasoningContent?.trim()) {
        const durationMs = msg.additional_kwargs?.reasoning_duration_ms
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
            const resultContent = toolResults.get(toolCall.id)

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

            const progress = toolCall.id in toolProgress ? toolProgress[toolCall.id] : undefined
            if (progress !== undefined && progress.status === 'running') {
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
              id: toolCall.id,
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
