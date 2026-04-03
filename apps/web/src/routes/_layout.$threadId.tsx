import { createFileRoute } from '@tanstack/react-router'
import { useStream } from '@langchain/langgraph-sdk/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import type {
  Message,
  PhaseGroup,
  PhaseInfo,
  ToolInvocationPart,
} from '@/components/ui/chat-message'
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
    onCustomEvent: (event: { type: string; phase: PhaseInfo['name'] }) => {
      if (event.type === 'phase_start') {
        setPhases(prev => [
          ...prev,
          { name: event.phase, startIdx: messagesLengthRef.current, endIdx: null },
        ])
      }
      if (event.type === 'phase_end') {
        setPhases(prev =>
          prev.map(p =>
            p.name === event.phase && p.endIdx === null
              ? { ...p, endIdx: messagesLengthRef.current }
              : p
          )
        )
      }
    },
  })

  const [phases, setPhases] = useState<Array<PhaseInfo>>([])
  const messagesLengthRef = useRef(0)

  useEffect(() => {
    setPhases([])
  }, [threadId])

  const joinedThreadId = useRef<string | null>(null)
  useEffect(() => {
    if (!threadId) return

    const resumeRunId = window.sessionStorage.getItem(`resume:${threadId}`)
    if (resumeRunId && joinedThreadId.current !== threadId) {
      stream.joinStream(resumeRunId, undefined, {
        streamMode: ['messages', 'values'],
        streamSubgraphs: true,
      })
      joinedThreadId.current = threadId
    }
  }, [threadId, stream])

  const items: Array<MessageListItem> = useMemo(() => {
    // Sync ref before render so onCustomEvent always reads the current count
    messagesLengthRef.current = stream.messages.length

    const allMessages: Array<{ originalIdx: number; message: Message }> = []

    let originalIdx = 0
    for (const message of stream.messages) {
      if (message.type === 'tool') {
        originalIdx++
        continue
      }

      if (
        message.type === 'human' ||
        message.type === 'system' ||
        message.type === 'function' ||
        message.type === 'remove'
      ) {
        allMessages.push({
          originalIdx,
          message: {
            id: message.id!,
            role: message.type === 'human' ? 'user' : 'assistant',
            content: Array.isArray(message.content)
              ? message.content
                  .filter(content => content.type === 'text')
                  .map(content => content.text)
                  .join('')
              : message.content,
          },
        })
        originalIdx++
        continue
      }

      const reasoningContent = message.additional_kwargs?.reasoning_content as string | undefined

      if (reasoningContent) {
        allMessages.push({
          originalIdx,
          message: {
            id: message.id!,
            role: 'assistant',
            content: reasoningContent,
            parts: [{ type: 'reasoning', reasoning: reasoningContent }],
          },
        })
      }

      const messageContent = Array.isArray(message.content)
        ? message.content
            .filter(content => content.type === 'text')
            .map(content => content.text)
            .join('')
        : message.content.toString().trim()

      if (messageContent) {
        allMessages.push({
          originalIdx,
          message: {
            id: message.id!,
            role: 'assistant',
            content: messageContent,
            parts: [{ type: 'text', text: messageContent }],
          },
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

          allMessages.push({
            originalIdx,
            message: {
              id: toolCall.id,
              role: 'assistant',
              content: '',
              parts,
            },
          })
        }
      }

      originalIdx++
    }

    // Group messages into phases
    const result: Array<MessageListItem> = []
    const phaseGroups = new Map<number, PhaseGroup>()

    for (let i = 0; i < phases.length; i++) {
      phaseGroups.set(i, { type: 'phase-group', phase: phases[i], messages: [] })
    }

    const insertedPhases = new Set<number>()

    for (const { originalIdx, message } of allMessages) {
      let assignedPhase: number | null = null
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]
        const end = phase.endIdx ?? stream.messages.length
        if (originalIdx >= phase.startIdx && originalIdx < end) {
          assignedPhase = i
          break
        }
      }

      // Insert any completed phase groups that should appear before this message
      for (let i = 0; i < phases.length; i++) {
        if (!insertedPhases.has(i) && phases[i].startIdx <= originalIdx) {
          insertedPhases.add(i)
          result.push(phaseGroups.get(i)!)
        }
      }

      if (assignedPhase !== null) {
        phaseGroups.get(assignedPhase)!.messages.push(message)
      } else {
        result.push(message)
      }
    }

    // Insert any remaining phase groups (e.g., phases with no messages like plan)
    for (let i = 0; i < phases.length; i++) {
      if (!insertedPhases.has(i)) {
        result.push(phaseGroups.get(i)!)
      }
    }

    return result
  }, [stream.messages, phases])

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
            {
              streamMode: ['messages', 'values'],
              streamSubgraphs: true,
              context,
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
            <p className="text-xs text-muted-foreground text-center">
              Press <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">Esc</kbd>{' '}
              to interrupt
            </p>
          )}

          {maxTokens != null && maxTokens > 0 && (
            <div className="ml-auto flex items-center justify-end gap-2 text-xs text-muted-foreground">
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
