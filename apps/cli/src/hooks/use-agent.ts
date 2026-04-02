import { useCallback, useReducer, useRef } from 'react'
import { HumanMessage } from '@langchain/core/messages'
import { estimateMessagesTokens } from '@zaga/agent/utils/token-budget'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { AppAction, AppState } from '@/reducer'
import { appReducer, initialState } from '@/reducer'

type UseAgentOptions = {
  agent: CompiledStateGraph<any, any, any>
  threadId: string
  projectPath: string
}

export function useAgent({ agent, threadId, projectPath }: UseAgentOptions) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async (text: string) => {
      dispatch({ type: 'send', userMessage: text })

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const stream = agent.streamEvents(
          { messages: [new HumanMessage(text)] },
          {
            configurable: { thread_id: threadId },
            context: { project_path: projectPath },
            signal: controller.signal,
            version: 'v2',
          }
        )

        for await (const event of stream) {
          if (event.event === 'on_chat_model_stream') {
            const chunk = event.data.chunk
            if (chunk.content && typeof chunk.content === 'string') {
              dispatch({ type: 'text_chunk', chunk: chunk.content })
            }
          } else if (event.event === 'on_tool_start') {
            dispatch({
              type: 'tool_start',
              toolCallId: event.run_id,
              name: event.name,
              input:
                typeof event.data.input === 'string'
                  ? event.data.input
                  : JSON.stringify(event.data.input ?? {}),
            })
          } else if (event.event === 'on_tool_end') {
            dispatch({
              type: 'tool_end',
              toolCallId: event.run_id,
              output:
                typeof event.data.output === 'string'
                  ? event.data.output
                  : JSON.stringify(event.data.output ?? {}),
            })
          }
        }

        // Stream finished — get final state for token count
        const snapshot = await agent.getState({ configurable: { thread_id: threadId } })
        if (snapshot.values?.messages) {
          dispatch({
            type: 'update_tokens',
            count: estimateMessagesTokens(snapshot.values.messages),
          })
        }

        dispatch({ type: 'stream_end' })
      } catch (error: any) {
        if (error.name === 'AbortError') {
          dispatch({ type: 'stream_end' })
        } else {
          dispatch({ type: 'stream_error', error: error.message ?? 'Unknown error' })
        }
      } finally {
        abortRef.current = null
      }
    },
    [agent, threadId, projectPath]
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { state, send, abort }
}
