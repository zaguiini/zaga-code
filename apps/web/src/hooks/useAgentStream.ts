import { useCallback, useReducer, useState } from 'react'
import { initialStreamState, streamReducer } from './streamReducer'
import type { RawLangGraphEvent, ToolProgress } from './streamReducer'
import { trpc } from '@/lib/trpc'

export type AgentStream = {
  streamingContent: string
  toolProgress: Record<string, ToolProgress>
  values: { usedTokens: number; maxTokens: number }
  isLoading: boolean
  error: string | null
  submit: (input: string) => void
  stop: () => void
}

type PendingRun = { input: string }

export function useAgentStream(threadId: string): AgentStream {
  const [pending, setPending] = useState<PendingRun | null>(null)
  const [state, dispatch] = useReducer(streamReducer, initialStreamState)
  const cancelMutation = trpc.runs.cancel.useMutation()
  const cancelMutate = cancelMutation.mutate

  trpc.runs.stream.useSubscription(
    pending ? { threadId, input: pending.input } : { threadId, input: '' },
    {
      enabled: pending !== null,
      onData(event: RawLangGraphEvent) {
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
    dispatch({ type: 'reset' })
    setPending({ input })
  }, [])

  const stop = useCallback(() => {
    cancelMutate({ threadId })
    setPending(null)
  }, [threadId, cancelMutate])

  return {
    streamingContent: state.streamingContent,
    toolProgress: state.toolProgress,
    values: state.values,
    isLoading: pending !== null,
    error: state.error,
    submit,
    stop,
  }
}
