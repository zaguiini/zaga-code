import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { MessageList } from '@/components/ui/message-list'
import { MessageInput } from '@/components/ui/message-input'
import { messageGrouper } from '@/lib/message-grouper'
import { StreamProvider } from '@/lib/stream-context'
import { useAgentStream } from '@/hooks/use-agent-stream'
import { trpc } from '@/lib/trpc'
import { fileToDataUrl } from '@/lib/file-to-data-url'

export const Route = createFileRoute('/_layout/$threadId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { threadId } = Route.useParams()
  const threadQuery = trpc.threads.get.useQuery({ threadId })
  const threadFilesQuery = trpc.threads.files.useQuery({ threadId })
  const stream = useAgentStream(threadId, threadQuery.data)
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<Array<File> | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const latestInputRef = useRef(input)
  const latestFilesRef = useRef(files)

  useEffect(() => {
    latestInputRef.current = input
  }, [input])

  useEffect(() => {
    latestFilesRef.current = files
  }, [files])

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
  }, [threadQuery.data, stream.isLoading, stream.values.messages])

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

  const items = useMemo(
    () => messageGrouper(stream.values.messages, stream.toolProgress),
    [stream.values.messages, stream.toolProgress]
  )

  const { usedTokens, maxTokens } = stream.values
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
          onSubmit={async e => {
            e.preventDefault()
            if (stream.isLoading || isSubmitting) return

            const trimmed = input.trim()
            const attachedFiles = files ?? []
            if (!trimmed && attachedFiles.length === 0) return

            stickToBottomRef.current = true

            setIsSubmitting(true)

            try {
              const submittedInput = input
              const submittedFiles = files
              const images = await Promise.all(attachedFiles.map(fileToDataUrl))
              stream.submit({ text: trimmed, images })

              if (latestInputRef.current === submittedInput) {
                setInput('')
              }
              if (latestFilesRef.current === submittedFiles) {
                setFiles(null)
              }
            } finally {
              setIsSubmitting(false)
            }
          }}
          className="shrink-0 w-full"
        >
          <fieldset disabled={isSubmitting}>
            <MessageInput
              autoFocus
              allowAttachments
              filePaths={threadFilesQuery.data?.files ?? []}
              folderPaths={threadFilesQuery.data?.folders ?? []}
              files={files}
              setFiles={setFiles}
              isGenerating={stream.isLoading || isSubmitting}
              value={input}
              onChange={e => setInput(e.target.value)}
            />
          </fieldset>
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
