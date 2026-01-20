import { createFileRoute } from '@tanstack/react-router'
import { useStream } from '@langchain/langgraph-sdk/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message, ToolInvocationPart } from '@/components/ui/chat-message'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'
import { env } from '@/env'

export const Route = createFileRoute('/_layout/$threadId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { threadId } = Route.useParams()

  const stream = useStream({
    assistantId: 'agent',
    apiUrl: env.VITE_LANGGRAPH_API_URL,
    threadId: threadId,
    reconnectOnMount: true,
    onCreated: created => {
      window.sessionStorage.setItem(`resume:${created.thread_id}`, created.run_id)
    },
    onFinish: (_, run) => {
      if (run?.thread_id) {
        window.sessionStorage.removeItem(`resume:${run.thread_id}`)
      }
    },
  })

  const joinedThreadId = useRef<string | null>(null)
  useEffect(() => {
    if (!threadId) return

    const resumeRunId = window.sessionStorage.getItem(`resume:${threadId}`)
    if (resumeRunId && joinedThreadId.current !== threadId) {
      stream.joinStream(resumeRunId, undefined, {
        streamMode: ['messages', 'values'],
      })
      joinedThreadId.current = threadId
    }
  }, [threadId, stream])

  const messages = useMemo(
    () =>
      stream.messages
        .filter(message => message.type !== 'tool')
        .map((message): Message | Array<Message> => {
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

          const result: Array<Message> = []

          const reasoningContent = message.additional_kwargs?.reasoning_content as
            | string
            | undefined

          if (reasoningContent) {
            result.push({
              id: message.id!,
              role: 'assistant',
              content: reasoningContent,
              parts: [
                {
                  type: 'reasoning',
                  reasoning: reasoningContent,
                },
              ],
            })
          }

          if (message.content) {
            result.push({
              id: message.id!,
              role: 'assistant',
              content: message.content as string,
              parts: [{ type: 'text', text: message.content as string }],
            })
          }

          const toolCalls = stream.getToolCalls(message)

          if (toolCalls.length > 0) {
            result.push(
              ...toolCalls.map(toolCall => {
                const parts: Array<ToolInvocationPart> = []

                if (toolCall.state === 'pending') {
                  parts.push({
                    type: 'tool-invocation',
                    toolInvocation: {
                      args: toolCall.call.args,
                      toolName: toolCall.call.name,
                      state: 'call',
                    },
                  })
                }

                if (toolCall.state === 'completed') {
                  parts.push({
                    type: 'tool-invocation',
                    toolInvocation: {
                      toolName: toolCall.call.name,
                      state: 'result',
                      args: toolCall.call.args,
                      result: toolCall.result?.content.toString() ?? 'No result',
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
        .flat(),
    [stream.messages]
  )

  const [input, setInput] = useState('')

  return (
    <div className="w-full h-full flex flex-col justify-center items-center gap-8">
      <div className="w-full flex-1 min-h-0 overflow-y-auto">
        <MessageList messages={messages} isTyping={stream.isLoading} />
      </div>
      <form
        onSubmit={e => {
          e.preventDefault()
          stream.submit(
            {
              messages: [{ type: 'human', content: [{ type: 'text', text: input }] }],
            },
            { streamMode: ['messages', 'values'] }
          )
          setInput('')
        }}
        className="shrink-0 w-full"
      >
        <MessageInput
          isGenerating={stream.isLoading}
          value={input}
          onChange={e => setInput(e.target.value)}
        />
      </form>
    </div>
  )
}
