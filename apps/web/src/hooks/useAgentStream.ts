import { useCallback, useLayoutEffect, useReducer, useState } from 'react'
import { initialStreamState, streamReducer } from './streamReducer'
import type { StreamState } from './streamReducer'
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
  const utils = trpc.useUtils()
  const [pending, setPending] = useState<PendingRun | null>(null)
  const [state, dispatch] = useReducer(streamReducer, initialStreamState)
  const cancelMutation = trpc.runs.cancel.useMutation()
  const cancelMutate = cancelMutation.mutate

  useLayoutEffect(() => {
    if (!historicalState) return

    dispatch({
      type: 'reset',
      state: historicalState,
    })
  }, [historicalState])

  const stream = trpc.runs.stream.useSubscription(
    pending ? { threadId, input: pending.input } : { threadId, input: '' },
    {
      enabled: pending !== null,
      onData(event) {
        const thread = threadsQuery.data?.threads.find(t => t.threadId === threadId)
        if (!thread?.firstMessage) {
          utils.threads.list.invalidate()
        }
        dispatch({ type: 'event', event })
      },
      onComplete() {
        setPending(null)
      },
      onError() {
        setPending(null)
      },
    }
  )

  const submit = useCallback((input: string) => {
    dispatch({ type: 'prepare' })
    setPending({ input })
  }, [])

  const stop = useCallback(() => {
    cancelMutate({ threadId })
    setPending(null)
  }, [threadId, cancelMutate])

  return {
    toolProgress: state.toolProgress,
    values: state.values,
    isLoading: stream.status === 'pending',
    error: state.error,
    submit,
    stop,
  }
}
