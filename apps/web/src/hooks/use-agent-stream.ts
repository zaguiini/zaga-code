import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { initialStreamState, streamReducer } from './stream-reducer'
import type { StreamState } from './stream-reducer'
import { trpc } from '@/lib/trpc'

export interface AgentStream extends StreamState {
  isLoading: boolean
  submit: (input: string) => void
  stop: () => void
}

type PendingRun = { input: string }

export function useAgentStream(
  threadId: string,
  historicalState?: StreamState['values']
): AgentStream {
  const threadsQuery = trpc.threads.list.useQuery()
  const runsQuery = trpc.runs.get.useQuery({ threadId })
  const utils = trpc.useUtils()
  const [pending, setPending] = useState<PendingRun | null>(null)
  const [state, dispatch] = useReducer(streamReducer, initialStreamState)
  const cancelMutation = trpc.runs.cancel.useMutation()
  const cancelMutate = cancelMutation.mutate
  const prevThreadIdRef = useRef(threadId)

  useLayoutEffect(() => {
    if (prevThreadIdRef.current !== threadId) {
      setPending(null)
      prevThreadIdRef.current = threadId
    }
  }, [threadId])

  const lastSyncedThreadIdRef = useRef<string | null>(null)

  const activeRunId = runsQuery.data?.activeRunId ?? null
  const isResuming = pending === null && !!activeRunId

  const subscriptionInput =
    pending !== null
      ? { threadId, mode: 'new' as const, input: pending.input }
      : { threadId, mode: 'resume' as const, runId: activeRunId ?? '' }

  const stream = trpc.runs.stream.useSubscription(subscriptionInput, {
    enabled: pending !== null || isResuming,
    onData(event) {
      const thread = threadsQuery.data?.threads.find(t => t.threadId === threadId)
      if (!thread?.firstMessage) {
        utils.threads.list.invalidate()
      }
      dispatch({ type: 'event', event: event.data })
    },
    onComplete() {
      setPending(null)
      void utils.threads.get.invalidate({ threadId })
    },
    onError() {
      setPending(null)
      void utils.threads.get.invalidate({ threadId })
    },
  })

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

  const submit = useCallback((input: string) => {
    const trimmed = input.trim()
    dispatch({ type: 'prepare', userText: trimmed })
    setPending({ input: trimmed })
  }, [])

  const stop = useCallback(() => {
    cancelMutate({ threadId })
    setPending(null)
  }, [threadId, cancelMutate])

  return {
    toolProgress: state.toolProgress,
    _agentToolScopes: state._agentToolScopes,
    values: state.values,
    isLoading: stream.status === 'pending',
    error: state.error,
    submit,
    stop,
  }
}
