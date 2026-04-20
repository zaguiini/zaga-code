import type { Message, ToolMessage, ToolProgress } from '@langchain/langgraph-sdk'
import type { Message as MessageType, ToolInvocationPart } from '@/components/ui/chat-message'

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

type CommandResult = {
  kind: string
  title: string
  contentMarkdown: string
  icon?: string
  scope?: string
}

function getCommandResult(additionalKwargs: unknown): CommandResult | undefined {
  if (!additionalKwargs || typeof additionalKwargs !== 'object') return undefined

  const candidate = additionalKwargs as Record<string, unknown>
  if (
    typeof candidate.kind !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.contentMarkdown !== 'string'
  ) {
    return undefined
  }

  return {
    kind: candidate.kind,
    title: candidate.title,
    contentMarkdown: candidate.contentMarkdown,
    ...(typeof candidate.icon === 'string' ? { icon: candidate.icon } : {}),
    ...(typeof candidate.scope === 'string' ? { scope: candidate.scope } : {}),
  }
}

export function extractText(content: string | Array<ContentPart>): string {
  if (typeof content === 'string') return content.trim()
  return content
    .filter(c => c.type === 'text' && c.text !== undefined)
    .map(c => c.text ?? '')
    .join('')
    .trim()
}

export const messageGrouper = (
  messages: Array<Message>,
  toolProgress: Record<string, ToolProgress | undefined>
): Array<MessageType> => {
  // Build a map of tool results keyed by tool_call_id
  const toolResults = new Map<string, { content: string; metadata?: Record<string, unknown> }>()
  for (const msg of messages) {
    if (msg.type === 'tool' && msg.tool_call_id) {
      toolResults.set(msg.tool_call_id, {
        content: extractText(msg.content),
        metadata: (msg as ToolMessage & { metadata?: Record<string, unknown> }).metadata,
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

      const commandResult = getCommandResult(msg.additional_kwargs)
      const messageContent = extractText(msg.content)

      if (messageContent && !commandResult) {
        result.push({
          id,
          role: 'assistant',
          content: messageContent,
          parts: [{ type: 'text', text: messageContent }],
        })
      }

      if (commandResult) {
        result.push({
          id: `${id}-command-result`,
          role: 'assistant',
          content: commandResult.title,
          parts: [
            {
              type: 'command-result',
              commandResult,
            },
          ],
        })
      }

      const toolCalls = msg.tool_calls ?? []
      if (toolCalls.length > 0) {
        result.push(
          ...toolCalls.map(toolCall => {
            const parts: Array<ToolInvocationPart> = []
            const toolResult = toolResults.get(toolCall.id!)

            if (toolResult !== undefined) {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.name,
                  state: 'result',
                  args: toolCall.args,
                  result: toolResult.content,
                  metadata: toolResult.metadata,
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
            } else if (toolResult === undefined) {
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
