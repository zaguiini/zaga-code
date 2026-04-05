import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'
import { messageGrouper } from '@/lib/message-grouper'
import { StreamProvider } from '@/lib/stream-context'
import { useAgentStream } from '@/hooks/useAgentStream'
import { trpc } from '@/lib/trpc'

export const Route = createFileRoute('/_layout/$threadId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { threadId } = Route.useParams()
  const stream = useAgentStream(threadId)
  const threadQuery = trpc.threads.get.useQuery({ threadId })
  const [input, setInput] = useState('')

  // Kick off graph if index route left a pending prompt in sessionStorage
  const didSubmitInitial = useRef(false)
  const streamSubmit = stream.submit
  useEffect(() => {
    if (didSubmitInitial.current) return
    const pending = sessionStorage.getItem(`pending-prompt:${threadId}`)
    if (pending) {
      sessionStorage.removeItem(`pending-prompt:${threadId}`)
      didSubmitInitial.current = true
      streamSubmit(pending)
    }
  }, [threadId, streamSubmit])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const BOTTOM_THRESHOLD_PX = 80

  const updateStickToBottom = () => {
    const el = scrollContainerRef.current
    if (!el) return
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX
  }

  useLayoutEffect(() => {
    stickToBottomRef.current = true
  }, [threadId])

  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [threadQuery.data, stream.streamingContent, stream.isLoading])

  const handleInterrupt = useCallback(() => {
    if (stream.isLoading) stream.stop()
  }, [stream])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleInterrupt()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleInterrupt])

  const historicalMessages = threadQuery.data?.messages ?? []
  const streamingMessage = stream.streamingContent
    ? [{ type: 'ai', content: stream.streamingContent }]
    : []
  const allMessages = [...historicalMessages, ...streamingMessage]

  const items = useMemo(
    () => messageGrouper(allMessages, stream.toolProgress),
    [allMessages, stream.toolProgress]
  )

  const usedTokens = stream.isLoading
    ? stream.values.usedTokens
    : (threadQuery.data?.usedTokens ?? 0)
  const maxTokens = stream.isLoading ? stream.values.maxTokens : (threadQuery.data?.maxTokens ?? 0)
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
            if (!input.trim() || stream.isLoading) return
            stickToBottomRef.current = true
            stream.submit(input)
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
              <div className="flex items-center gap-2">
                <Loader2 className="size-3 mx-0.5 animate-spin" />
                <span className="text-xs text-muted-foreground">Working...</span>
                <p className="text-xs text-muted-foreground">
                  Press{' '}
                  <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd> to
                  interrupt
                </p>
              </div>
            )}
            {maxTokens > 0 && usedTokens > 0 && (
              <div className="ml-auto text-xs text-muted-foreground">
                {usedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens (
                {contextPercent}%)
              </div>
            )}
          </div>
        </form>
      </div>
    </StreamProvider>
  )
}
