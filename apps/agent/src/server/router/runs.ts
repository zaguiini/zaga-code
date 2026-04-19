import { tracked } from '@trpc/server'
import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'
import { procedure, router } from '../trpc'
import type { Message } from '@langchain/langgraph-sdk'
import type { StreamEvent } from '@langchain/core/types/stream'
import { db } from '@/db'
import { serializeMessages, toMessageUnion } from '@/utils/messages'
// ── Serialized stream event types (consumed by the frontend via tRPC inference) ──

type SerializedEventMeta = {
  tool_call_id?: string
  checkpoint_ns?: string
  langgraph_checkpoint_ns?: string
  [key: string]: unknown
}

type SerializedBaseEvent = {
  name: string
  run_id: string
  tags?: Array<string>
  metadata: SerializedEventMeta
}

export type SerializedStreamEvent =
  | (SerializedBaseEvent & {
      event: 'on_chat_model_stream'
      data: { chunk: Message }
    })
  | (SerializedBaseEvent & {
      event: 'on_tool_start'
      data: { input: Record<string, unknown> }
    })
  | (SerializedBaseEvent & {
      event: 'on_tool_end'
      data: { output: Record<string, unknown> }
    })
  | (SerializedBaseEvent & {
      event: 'on_chain_start'
      data: { input?: Record<string, unknown> }
    })
  | (SerializedBaseEvent & {
      event: 'on_chain_end'
      data: { output?: Record<string, unknown> }
    })

// ── Serialization helpers ──

function serializeEvent(event: StreamEvent): SerializedStreamEvent | null {
  const base: SerializedBaseEvent = {
    name: event.name,
    run_id: event.run_id,
    tags: event.tags,
    metadata: event.metadata,
  }

  switch (event.event) {
    case 'on_chat_model_stream': {
      const chunk = event.data.chunk
      if (!BaseMessage.isInstance(chunk)) return null
      return { ...base, event: 'on_chat_model_stream', data: { chunk: toMessageUnion(chunk) } }
    }
    case 'on_tool_start':
      return { ...base, event: 'on_tool_start', data: { input: event.data.input ?? {} } }
    case 'on_tool_end':
      return { ...base, event: 'on_tool_end', data: { output: event.data.output ?? {} } }
    case 'on_chain_start': {
      const input = event.data.input
      if (input != null && Array.isArray(input.messages)) {
        return {
          ...base,
          event: 'on_chain_start',
          data: { input: { ...input, messages: serializeMessages(input.messages) } },
        }
      }
      return { ...base, event: 'on_chain_start', data: { input: input ?? undefined } }
    }
    case 'on_chain_end': {
      const output = event.data.output
      if (output != null && Array.isArray(output.messages)) {
        return {
          ...base,
          event: 'on_chain_end',
          data: { output: { ...output, messages: serializeMessages(output.messages) } },
        }
      }
      return { ...base, event: 'on_chain_end', data: { output: output ?? undefined } }
    }
    default:
      return null
  }
}

type RunRow = {
  run_id: string
}

type RunBuffer = {
  events: Array<SerializedStreamEvent>
  ac: AbortController
  isComplete: boolean
  subscribers: number
  notify: () => void
  nextEventPromise: () => Promise<void>
}

function createRunBuffer(ac: AbortController): RunBuffer {
  const waiters: Array<() => void> = []
  return {
    events: [],
    ac,
    isComplete: false,
    subscribers: 0,
    notify() {
      const current = waiters.splice(0)
      for (const r of current) r()
    },
    nextEventPromise() {
      return new Promise<void>(r => waiters.push(r))
    },
  }
}

const runBuffers = new Map<string, RunBuffer>()
const threadRunMap = new Map<string, string>()

/** Remove a run buffer if the run is finished and no one is listening. */
function maybeCleanupBuffer(runId: string, threadId: string, buffer: RunBuffer) {
  if (buffer.isComplete && buffer.subscribers === 0) {
    runBuffers.delete(runId)
    threadRunMap.delete(threadId)
  }
}

export const runsRouter = router({
  get: procedure.input(z.object({ threadId: z.string() })).query(({ input }) => {
    const row = db
      .prepare('SELECT run_id FROM runs WHERE thread_id = ? AND status = ? LIMIT 1')
      .get(input.threadId, 'running') as RunRow | undefined
    return { activeRunId: row?.run_id ?? null }
  }),

  stream: procedure
    .input(
      z.object({
        threadId: z.string(),
        input: z.string().optional(),
        // tRPC sends this automatically on SSE reconnection via httpSubscriptionLink
        lastEventId: z.string().nullish(),
      })
    )
    .subscription(async function* ({ input, ctx }) {
      const { threadId } = input

      let runId: string | undefined
      let buffer: RunBuffer | undefined
      let startIdx = 0

      // 1. SSE reconnection: lastEventId contains "runId:idx", look up buffer directly
      if (input.lastEventId) {
        const colonIdx = input.lastEventId.lastIndexOf(':')
        if (colonIdx !== -1) {
          const resumeRunId = input.lastEventId.slice(0, colonIdx)
          const resumeBuffer = runBuffers.get(resumeRunId)
          if (resumeBuffer) {
            runId = resumeRunId
            buffer = resumeBuffer
            startIdx = parseInt(input.lastEventId.slice(colonIdx + 1), 10) + 1
          } else {
            // Buffer already cleaned up — run finished and was fully consumed
            return
          }
        }
      }

      // 2. Active run on this thread (page refresh, React Strict Mode double-invoke)
      if (!buffer) {
        const activeRunId = threadRunMap.get(threadId)
        const activeBuffer = activeRunId ? runBuffers.get(activeRunId) : undefined
        if (activeBuffer && !activeBuffer.isComplete && !activeBuffer.ac.signal.aborted) {
          runId = activeRunId!
          buffer = activeBuffer
        }
      }

      // 3. Start a new run
      if (!buffer && input.input) {
        runId = crypto.randomUUID()
        db.prepare('INSERT INTO runs (run_id, thread_id, status) VALUES (?, ?, ?)').run(
          runId,
          threadId,
          'running'
        )

        const ac = new AbortController()
        buffer = createRunBuffer(ac)
        runBuffers.set(runId, buffer)
        threadRunMap.set(threadId, runId)

        // Run LangGraph as a detached background task — NOT tied to the SSE connection.
        // This keeps the run alive across page refreshes.
        void (async () => {
          try {
            const eventStream = ctx.graph.streamEvents(
              { messages: [{ type: 'human', content: [{ type: 'text', text: input.input! }] }] },
              {
                subgraphs: true,
                version: 'v2',
                configurable: { thread_id: threadId },
                signal: ac.signal,
              }
            )
            for await (const event of eventStream) {
              const serialized = serializeEvent(event)
              if (serialized) {
                buffer.events.push(serialized)
                buffer.notify()
              }
            }
            db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run('completed', runId)
          } catch {
            db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run('failed', runId)
          } finally {
            buffer.isComplete = true
            buffer.notify()
            // Cleanup only if no subscriber is currently draining.
            // Otherwise the subscriber's finally block will handle it.
            maybeCleanupBuffer(runId, threadId, buffer)
          }
        })()
      }

      if (!buffer || !runId) return

      // Track this subscriber so the buffer isn't cleaned up while we're draining.
      buffer.subscribers++
      try {
        let idx = startIdx
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (true) {
          const nextP = buffer.nextEventPromise()
          while (idx < buffer.events.length) {
            yield tracked(`${runId}:${idx}`, buffer.events[idx])
            idx++
          }
          if (buffer.isComplete || buffer.ac.signal.aborted) break
          await nextP
        }
      } finally {
        buffer.subscribers--
        maybeCleanupBuffer(runId, threadId, buffer)
      }
    }),

  cancel: procedure.input(z.object({ threadId: z.string() })).mutation(({ input }) => {
    const row = db
      .prepare('SELECT run_id FROM runs WHERE thread_id = ? AND status = ? LIMIT 1')
      .get(input.threadId, 'running') as RunRow | undefined
    if (row) {
      runBuffers.get(row.run_id)?.ac.abort()
    }
    return { ok: true }
  }),
})
