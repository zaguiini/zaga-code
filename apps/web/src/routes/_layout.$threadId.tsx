import { createFileRoute } from '@tanstack/react-router'
import { useStream } from '@langchain/langgraph-sdk/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'
import { env } from '@/env'
import { messageGrouper } from '@/lib/message-grouper'
import { StreamProvider } from '@/lib/stream-context'

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
        streamMode: ['messages', 'values', 'tools'],
      })
      joinedThreadId.current = threadId
    }
  }, [threadId, stream])

  const items = useMemo(() => {
    return messageGrouper(stream.messages, stream.toolProgress)
  }, [stream.messages, stream.toolProgress])

  const handleInterrupt = useCallback(() => {
    if (!stream.isLoading) return

    stream.stop()

    const runId = window.sessionStorage.getItem(`resume:${threadId}`)
    if (runId) {
      stream.client.runs.cancel(threadId, runId)
    }
  }, [stream, threadId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleInterrupt()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleInterrupt])

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
  }, [items, stream.isLoading])

  const streamValues = stream.values as Record<string, unknown> | null
  const maxTokens = (streamValues?.maxTokens as number | undefined) ?? 0
  const usedTokens = (streamValues?.usedTokens as number | undefined) ?? 0
  const contextPercent = maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 100) : null

  return (
    <StreamProvider toolProgress={stream.toolProgress}>
      <div className="w-full h-full flex flex-col justify-center items-center gap-8">
        <div
          ref={scrollContainerRef}
          onScroll={updateStickToBottom}
          className="w-full flex-1 min-h-0 overflow-y-auto"
        >
          <MessageList messages={items} />
        </div>
        <form
          onSubmit={e => {
            e.preventDefault()
            stickToBottomRef.current = true
            stream.submit(
              {
                messages: [{ type: 'human', content: [{ type: 'text', text: input }] }],
              },
              {
                streamMode: ['messages', 'values', 'tools'],
                streamSubgraphs: true,
                config: { recursion_limit: 1000 },
              }
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
          <div className="flex items-center justify-between gap-2">
            {stream.isLoading && (
              <div className="flex items-center justify-center gap-2">
                <div className="flex items-center justify-center gap-0.5">
                  <Loader2 className="size-3 mx-0.5 animate-spin" />
                  <span className="text-xs text-muted-foreground text-center">Working...</span>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Press{' '}
                  <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd> to
                  interrupt
                </p>
              </div>
            )}

            {maxTokens > 0 && usedTokens > 0 && (
              <div className="ml-auto flex items-center justify-end text-xs text-muted-foreground">
                {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens (
                {contextPercent}
                %)
              </div>
            )}
          </div>
        </form>
      </div>
    </StreamProvider>
  )
}
