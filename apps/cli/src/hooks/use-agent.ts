import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { useCallback, useLayoutEffect, useReducer, useRef } from 'react'
import { HumanMessage } from '@langchain/core/messages'
import { estimateMessagesTokens } from '@zaga/agent/utils/token-budget'
import type { CompiledStateGraph } from '@langchain/langgraph'
import { appReducer, initialState } from '@/reducer'
import { zagaEventsLogPath } from '@/session'

type UseAgentOptions = {
  agent: CompiledStateGraph<any, any, any>
  threadId: string
  projectPath: string
}

function extractChunkText(chunk: any): string | null {
  // Plain string content (most common)
  if (typeof chunk.content === 'string' && chunk.content) {
    return chunk.content
  }
  // Array of content blocks (e.g. [{type: 'text', text: '...'}])
  if (Array.isArray(chunk.content)) {
    const texts = chunk.content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text)
    return texts.length > 0 ? texts.join('') : null
  }
  return null
}

async function logEvent(
  eventsLogPath: string,
  threadId: string,
  type: 'stream_start' | 'stream_end',
  data?: Record<string, unknown>
): Promise<void> {
  const payload = { ts: new Date().toISOString(), threadId, type, ...data }
  try {
    await appendFile(eventsLogPath, `${JSON.stringify(payload)}\n`, 'utf-8')
  } catch {
    // Best-effort; never break the run on I/O errors
  }
}

export function useAgent({ agent, threadId, projectPath }: UseAgentOptions) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const abortRef = useRef<AbortController | null>(null)

  // Hydrate token count from existing thread state on mount
  useLayoutEffect(() => {
    agent
      .getState({ configurable: { thread_id: threadId } })
      .then(snapshot => {
        if (snapshot.values?.messages) {
          dispatch({
            type: 'update_tokens',
            count: estimateMessagesTokens(snapshot.values.messages),
            maxTokens: snapshot.values.maxTokens ?? 0,
          })
        }
      })
      .catch(() => {
        // No existing state — fresh session
      })
  }, [agent, threadId])

  const send = useCallback(
    async (text: string) => {
      dispatch({ type: 'send', userMessage: text })

      const controller = new AbortController()
      abortRef.current = controller

      const eventsLogPath = zagaEventsLogPath(threadId)
      await mkdir(dirname(eventsLogPath), { recursive: true })

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

        // Nodes whose LLM output should NOT be shown in the UI
        const silentNodes = new Set(['should-plan', 'make-plan', 'maybe-compact'])

        // Log stream start
        await logEvent(eventsLogPath, threadId, 'stream_start', { userMessage: text })

        for await (const event of stream) {
          if (event.event === 'on_chat_model_stream') {
            // Suppress output from gate/planning nodes (they emit "yes"/"no", plans, etc.)
            const node = event.metadata.langgraph_node
            if (node && silentNodes.has(node)) continue
            const chunk = event.data.chunk
            const chunkText = extractChunkText(chunk)
            if (chunkText) {
              dispatch({ type: 'text_chunk', chunk: chunkText })
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

        // Stream finished — get final state for token count and context info
        const snapshot = await agent.getState({ configurable: { thread_id: threadId } })
        if (snapshot.values?.messages) {
          dispatch({
            type: 'update_tokens',
            count: estimateMessagesTokens(snapshot.values.messages),
            maxTokens: snapshot.values.maxTokens ?? 0,
          })
        }

        dispatch({ type: 'stream_end' })

        // Log stream end
        await logEvent(eventsLogPath, threadId, 'stream_end')
      } catch (error: any) {
        if (error.name === 'AbortError') {
          dispatch({ type: 'stream_end' })
          await logEvent(eventsLogPath, threadId, 'stream_end', { aborted: true })
        } else {
          dispatch({ type: 'stream_error', error: error.message ?? 'Unknown error' })
          await logEvent(eventsLogPath, threadId, 'stream_end', {
            error: error.message ?? 'Unknown error',
          })
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
