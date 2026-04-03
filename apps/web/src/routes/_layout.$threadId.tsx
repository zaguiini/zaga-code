import { createFileRoute } from '@tanstack/react-router'
import { useStream } from '@langchain/langgraph-sdk/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { Message, PhaseGroup, ToolInvocationPart } from '@/components/ui/chat-message'
import type { MessageListItem } from '@/components/ui/message-list'
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

  const items: Array<MessageListItem> = useMemo(() => {
    const result: Array<MessageListItem> = []
    let currentPhase: PhaseGroup | null = null

    for (const message of stream.messages) {
      // Check for phase marker messages
      const phaseMarker = message.additional_kwargs?.phase_marker as string | undefined
      const phaseEvent = message.additional_kwargs?.phase_event as string | undefined

      if (phaseMarker && phaseEvent === 'start') {
        currentPhase = {
          type: 'phase-group',
          phase: { name: phaseMarker as PhaseGroup['phase']['name'], endIdx: null, startIdx: 0 },
          messages: [],
        }
        result.push(currentPhase)
        continue
      }

      if (phaseMarker && phaseEvent === 'end') {
        if (currentPhase) {
          currentPhase.phase.endIdx = 1 // just mark as completed (non-null)
        }
        currentPhase = null
        continue
      }

      // Skip tool messages from display
      if (message.type === 'tool') continue

      // Transform message into display format
      const displayMessages: Array<Message> = []

      if (
        message.type === 'human' ||
        message.type === 'system' ||
        message.type === 'function' ||
        message.type === 'remove'
      ) {
        displayMessages.push({
          id: message.id!,
          role: message.type === 'human' ? 'user' : 'assistant',
          content: Array.isArray(message.content)
            ? message.content
                .filter(content => content.type === 'text')
                .map(content => content.text)
                .join('')
            : message.content,
        })
      } else {
        // AI message — split into reasoning, text, tool call parts
        const reasoningContent = message.additional_kwargs?.reasoning_content as string | undefined

        // Skip phase-tagged messages with no visible content (markers without start/end event)
        if (phaseMarker && !message.content && !reasoningContent) continue

        if (reasoningContent) {
          displayMessages.push({
            id: message.id!,
            role: 'assistant',
            content: reasoningContent,
            parts: [{ type: 'reasoning', reasoning: reasoningContent }],
          })
        }

        const messageContent = Array.isArray(message.content)
          ? message.content
              .filter(content => content.type === 'text')
              .map(content => content.text)
              .join('')
          : message.content.toString().trim()

        if (messageContent) {
          displayMessages.push({
            id: message.id!,
            role: 'assistant',
            content: messageContent,
            parts: [{ type: 'text', text: messageContent }],
          })
        }

        const toolCalls = stream.getToolCalls(message)

        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
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

            displayMessages.push({
              id: toolCall.id,
              role: 'assistant',
              content: '',
              parts,
            })
          }
        }
      }

      // Add to current phase group or to top-level result
      if (currentPhase) {
        currentPhase.messages.push(...displayMessages)
      } else {
        result.push(...displayMessages)
      }
    }

    return result
  }, [stream.messages])

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

  const maxTokens = (stream.values as Record<string, unknown> | null)?.maxTokens as
    | number
    | undefined
  const estimatedTokens = useMemo(() => {
    const msgs = stream.messages
    return msgs.reduce((total, msg) => {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map(c => ('text' in c ? c.text : '')).join('')
            : ''
      return total + Math.ceil(content.length / 4)
    }, 0)
  }, [stream.messages])

  const contextPercent = maxTokens ? Math.round((estimatedTokens / maxTokens) * 100) : null

  return (
    <div className="w-full h-full flex flex-col justify-center items-center gap-8">
      <div
        ref={scrollContainerRef}
        onScroll={updateStickToBottom}
        className="w-full flex-1 min-h-0 overflow-y-auto"
      >
        <MessageList messages={items} isTyping={stream.isLoading} />
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
        <div className="flex items-center justify-between gap-2">
          {stream.isLoading && (
            <p className="text-xs text-muted-foreground text-center">
              Press <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd>{' '}
              to interrupt
            </p>
          )}

          {maxTokens != null && maxTokens > 0 && (
            <div className="ml-auto flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <span>
                ~{estimatedTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
              </span>
              <span>({contextPercent}%)</span>
            </div>
          )}
        </div>
      </form>
    </div>
  )
}
