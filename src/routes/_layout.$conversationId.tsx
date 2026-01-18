import { createFileRoute } from '@tanstack/react-router'
import { useStream } from '@langchain/langgraph-sdk/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '@/components/ui/chat-message'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'

export const Route = createFileRoute('/_layout/$conversationId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { conversationId } = Route.useParams()

  const stream = useStream({
    assistantId: 'agent',
    apiUrl: 'http://localhost:2024',
    threadId: conversationId,
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
    if (!conversationId) return

    const resumeRunId = window.sessionStorage.getItem(`resume:${conversationId}`)
    if (resumeRunId && joinedThreadId.current !== conversationId) {
      stream.joinStream(resumeRunId)
      joinedThreadId.current = conversationId
    }
  }, [conversationId, stream])

  console.log(stream.messages)

  // You know what to do.
  // https://docs.langchain.com/oss/python/langchain/streaming/frontend#rendering-tool-calls
  // https://docs.langchain.com/oss/python/langchain/streaming/frontend#reasoning-models
  const messages = useMemo(
    () =>
      stream.messages
        .filter(message => typeof message.content === 'string' && message.content !== '')
        .map((message): Message => {
          const baseMessage = {
            id: message.id!,
            role: message.type === 'human' ? 'user' : 'assistant',
          }

          return {
            ...baseMessage,
            content: message.content as string,
          }
        }),
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
          stream.submit({ messages: [{ type: 'human', content: input }] })
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
