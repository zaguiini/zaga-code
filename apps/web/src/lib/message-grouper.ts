import { getToolCallsWithResults } from '@langchain/langgraph-sdk/utils'
import type { Message, ToolProgress } from '@langchain/langgraph-sdk'
import type { DefaultToolCall } from '@langchain/langgraph-sdk/react'
import type { Message as MessageType, ToolInvocationPart } from '@/components/ui/chat-message'

export const messageGrouper = (
  messages: Array<Message<DefaultToolCall>>,
  toolProgress: Array<ToolProgress>
) => {
  const threadToolCalls = getToolCallsWithResults(messages)
  return messages
    .filter(message => message.type !== 'tool')
    .map((message): MessageType | Array<MessageType> => {
      if (
        message.type === 'human' ||
        message.type === 'system' ||
        message.type === 'function' ||
        message.type === 'remove'
      ) {
        return {
          id: message.id!,
          role: message.type === 'human' ? 'user' : 'assistant',
          content: Array.isArray(message.content)
            ? message.content
                .filter(content => content.type === 'text')
                .map(content => content.text)
                .join('')
            : message.content,
        }
      }

      const result: Array<MessageType> = []

      const reasoningContent = message.additional_kwargs?.reasoning_content as string | undefined

      if (reasoningContent?.trim()) {
        const durationMs = message.additional_kwargs?.reasoning_duration_ms as number | undefined
        const reasoningDone = durationMs != null

        result.push({
          id: message.id!,
          role: 'assistant',
          content: reasoningContent,
          parts: [
            {
              type: 'reasoning',
              reasoning: reasoningContent,
              durationMs,
              done: reasoningDone,
            },
          ],
        })
      }

      const messageContent = Array.isArray(message.content)
        ? message.content
            .filter(content => content.type === 'text')
            .map(content => content.text)
            .join('')
        : message.content.toString().trim()

      if (messageContent) {
        result.push({
          id: message.id!,
          role: 'assistant',
          content: messageContent,
          parts: [{ type: 'text', text: messageContent }],
        })
      }

      const toolCalls = threadToolCalls.filter(threadCall => threadCall.aiMessage.id === message.id)

      if (toolCalls.length > 0) {
        result.push(
          ...toolCalls.map(toolCall => {
            const parts: Array<ToolInvocationPart> = []

            if (toolCall.state === 'completed') {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  // @ts-expect-error - TODO: This is not typed
                  metadata: toolCall.result?.metadata,
                  toolName: toolCall.call.name,
                  state: 'result',
                  args: toolCall.call.args,
                  result: toolCall.result?.content.toString() ?? 'No result',
                },
              })
            }

            const progress = toolProgress.find(tp => tp.toolCallId === toolCall.call.id)

            if (progress?.state === 'running') {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: toolCall.call.name,
                  state: 'streaming',
                  args: toolCall.call.args,
                  data: progress.data,
                },
              })
            } else if (toolCall.state === 'pending') {
              parts.push({
                type: 'tool-invocation',
                toolInvocation: {
                  args: toolCall.call.args,
                  toolName: toolCall.call.name,
                  state: 'call',
                },
              })
            }

            return {
              id: toolCall.id,
              role: 'assistant',
              content: '',
              parts,
            }
          })
        )
      }

      return result
    })
    .flat()
}
