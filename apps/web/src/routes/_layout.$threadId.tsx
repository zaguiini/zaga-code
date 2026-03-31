import { createFileRoute } from '@tanstack/react-router'
import { useStream } from '@langchain/langgraph-sdk/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { Message, ToolInvocationPart } from '@/components/ui/chat-message'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'
import { env } from '@/env'
import { threadsSearchQuery } from '@/queries/threads'

export const Route = createFileRoute('/_layout/$threadId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { threadId } = Route.useParams()

  const thread = useSuspenseQuery({
    ...threadsSearchQuery(),
    select: data => data.find(threadCandidate => threadCandidate.thread_id === threadId),
  })

  const context = thread.data?.metadata?.context as { project_path: string } | undefined

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

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const BOTTOM_THRESHOLD_PX = 80

  const updateStickToBottom = () => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX
  }

  useLayoutEffect(() => {
    stickToBottomRef.current = true
  }, [threadId])

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, stream.isLoading])

  return (
    <div className="w-full h-full flex flex-col justify-center items-center gap-8">
      <div
        ref={scrollContainerRef}
        onScroll={updateStickToBottom}
        className="w-full flex-1 min-h-0 overflow-y-auto"
      >
        <MessageList messages={messages} isTyping={stream.isLoading} />
      </div>
      <form
        onSubmit={e => {
          e.preventDefault()
          stickToBottomRef.current = true
          stream.submit(
            {
              messages: [{ type: 'human', content: [{ type: 'text', text: input }] }],
            },
            { streamMode: ['messages', 'values'], context, config: { recursion_limit: 1000 } }
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
