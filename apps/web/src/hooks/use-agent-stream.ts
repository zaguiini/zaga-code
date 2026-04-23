import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { initialStreamStateV2, streamReducerV2 } from './stream-reducer-v2'
import type { StreamStateV2 } from './stream-reducer-v2'
import { trpc } from '@/lib/trpc'

type RunImageInput = {
  name: string
  url: string
  mimeType: string
}

type RunInput = {
  text: string
  images: Array<RunImageInput>
}

export interface AgentStream extends StreamStateV2 {
  isLoading: boolean
  submit: (input: RunInput) => void
  stop: () => void
}

export function useAgentStream(
  threadId: string,
  historicalState?: StreamStateV2['values']
): AgentStream {
  const threadsQuery = trpc.threads.list.useQuery()
  const runsQuery = trpc.runs.get.useQuery({ threadId })
  const utils = trpc.useUtils()
  const [isStarting, setIsStarting] = useState(false)
  const [pendingRunId, setPendingRunId] = useState<string | null>(null)
  const [state, dispatch] = useReducer(streamReducerV2, initialStreamStateV2)
  const cancelMutation = trpc.runs.cancel.useMutation()
  const startMutation = trpc.runs.start.useMutation()
  const cancelMutate = cancelMutation.mutate
  const prevThreadIdRef = useRef(threadId)

  useLayoutEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      setIsStarting(false)
      setPendingRunId(null)
      prevThreadIdRef.current = threadId
    }
  }, [threadId])

  const lastSyncedThreadIdRef = useRef<string | null>(null)

  const activeRunId = runsQuery.data?.activeRunId ?? null
  const subscribedRunId = pendingRunId ?? activeRunId

  const stream = trpc.runs.stream.useSubscription(
    { threadId, ...(subscribedRunId ? { runId: subscribedRunId } : {}) },
    {
      enabled: !!subscribedRunId,
      onData(event) {
        const thread = threadsQuery.data?.threads.find(t => t.threadId === threadId)
        if (!thread?.firstMessage) {
          utils.threads.list.invalidate()
        }
        dispatch({ type: 'event', event: event.data })
      },
      onComplete() {
        setIsStarting(false)
        setPendingRunId(null)
        void utils.threads.get.invalidate({ threadId })
        void utils.threads.files.invalidate({ threadId })
        void utils.runs.get.invalidate({ threadId })
      },
      onError() {
        setIsStarting(false)
        setPendingRunId(null)
        void utils.threads.get.invalidate({ threadId })
        void utils.threads.files.invalidate({ threadId })
        void utils.runs.get.invalidate({ threadId })
      },
    }
  )

  useLayoutEffect(() => {
    const threadSwitched = lastSyncedThreadIdRef.current !== threadId
    if (threadSwitched) {
      lastSyncedThreadIdRef.current = threadId
      if (historicalState) {
        dispatch({ type: 'reset', state: historicalState })
      } else {
        dispatch({ type: 'reset' })
      }
      return
    }

    if (!historicalState) return
    if (stream.status === 'pending') return
    if (state.values.messages.length > historicalState.messages.length) return

    dispatch({ type: 'reset', state: historicalState })
  }, [threadId, historicalState, stream.status, state.values.messages.length])

  const submit = useCallback(
    (input: RunInput) => {
      const text = input.text.trim()
      if (!text && input.images.length === 0) return

      setIsStarting(true)
      startMutation.mutate(
        { threadId, input: { ...input, text } },
        {
          onSuccess(data) {
            if (!data.runId) {
              setIsStarting(false)
              return
            }

            setPendingRunId(data.runId)
            dispatch({ type: 'prepare', userText: text })
            void utils.runs.get.invalidate({ threadId })
            void utils.threads.list.invalidate()
            void utils.threads.get.invalidate({ threadId })
          },
          onError() {
            setIsStarting(false)
            setPendingRunId(null)
          },
        }
      )
    },
    [startMutation, threadId, utils]
  )

  const stop = useCallback(() => {
    cancelMutate({ threadId })
    setIsStarting(false)
    setPendingRunId(null)
  }, [threadId, cancelMutate])

  return {
    toolProgress: state.toolProgress,
    _agentToolScopes: state._agentToolScopes,
    values: state.values,
    isLoading: isStarting || stream.status === 'pending',
    error: state.error,
    submit,
    stop,
  }
}
