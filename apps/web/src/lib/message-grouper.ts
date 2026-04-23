import type { Message as MessageType, ToolInvocationPart } from '@/components/ui/chat-message'
import type { AgentState } from '@/lib/trpc'

type ContentPart = {
  type: string
  name?: string
  text?: string
  image_url?:
    | string
    | {
        url?: string
      }
}

type AgentMessage = AgentState['messages'][number]

type ToolResult = {
  content: string
  metadata?: Record<string, unknown>
}

function getContentParts(content: string | Array<ContentPart>): Array<ContentPart> {
  return Array.isArray(content) ? content : []
}

function getImageAttachments(content: string | Array<ContentPart>) {
  return getContentParts(content)
    .filter(
      (part): part is ContentPart & { image_url: { url: string } } =>
        part.type === 'image_url' &&
        !!part.image_url &&
        typeof part.image_url !== 'string' &&
        typeof part.image_url.url === 'string'
    )
    .map(part => ({
      name: part.name,
      url: part.image_url.url,
      contentType: getAttachmentContentType(part.image_url.url),
    }))
}

function getAttachmentContentType(url: string): string | undefined {
  const dataUrlMatch = url.match(/^data:([^;,]+)[;,]/)
  return dataUrlMatch?.[1]
}

function getAttachmentFallbackLabel(attachmentCount: number): string {
  return attachmentCount === 1 ? 'Attached image' : 'Attached images'
}

export function extractText(content: string | Array<ContentPart>): string {
  if (typeof content === 'string') return content.trim()
  return content
    .filter(c => c.type === 'text' && c.text !== undefined)
    .map(c => c.text ?? '')
    .join('')
    .trim()
}

export const messageGrouper = (messages: Array<AgentMessage>): Array<MessageType> => {
  const toolResults = new Map<string, ToolResult>()
  for (const msg of messages) {
    if (msg.type === 'tool' && msg.tool_call_id) {
      toolResults.set(msg.tool_call_id, {
        content: extractText(msg.content),
        ...(msg.metadata ? { metadata: msg.metadata } : {}),
      })
    }
  }

  return messages
    .filter(msg => msg.type !== 'tool')
    .flatMap((msg): Array<MessageType> => {
      const id = msg.id ?? Math.random().toString(36).slice(2)

      if (msg.type !== 'ai') {
        const experimental_attachments = getImageAttachments(msg.content)
        const textContent = extractText(msg.content)
        const content =
          textContent ||
          (experimental_attachments.length > 0
            ? getAttachmentFallbackLabel(experimental_attachments.length)
            : '')

        return [
          {
            id,
            role: msg.type === 'human' ? 'user' : 'assistant',
            content,
            experimental_attachments:
              experimental_attachments.length > 0 ? experimental_attachments : undefined,
          },
        ]
      }

      const result: Array<MessageType> = []

      const reasoningContent = msg.reasoning
      if (reasoningContent?.trim()) {
        const startedAtMs = msg.reasoning_started_at_ms
        const endedAtMs = msg.reasoning_ended_at_ms
        const done = endedAtMs !== undefined || startedAtMs === undefined
        const durationMs =
          startedAtMs !== undefined && endedAtMs !== undefined
            ? Math.max(0, endedAtMs - startedAtMs)
            : undefined

        result.push({
          id,
          role: 'assistant',
          content: reasoningContent,
          parts: [
            {
              type: 'reasoning',
              reasoning: reasoningContent,
              done,
              ...(durationMs !== undefined ? { durationMs } : {}),
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
            const persistedToolResult = toolResults.get(toolCall.id)
            const inMessageResult =
              toolCall.result !== undefined
                ? {
                    content: toolCall.result,
                    ...(toolCall.result_metadata ? { metadata: toolCall.result_metadata } : {}),
                  }
                : undefined
            const toolResult = persistedToolResult ?? inMessageResult

            if (toolResult !== undefined) {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'result',
                  toolCallId: toolCall.id,
                  args: toolCall.args,
                  result: toolResult.content,
                  metadata: toolResult.metadata,
                },
              })
            } else if (toolCall.state === 'streaming') {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'streaming',
                  toolCallId: toolCall.id,
                  args: toolCall.args,
                  data: toolCall.stream_data,
                },
              })
            } else {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'call',
                  toolCallId: toolCall.id,
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
