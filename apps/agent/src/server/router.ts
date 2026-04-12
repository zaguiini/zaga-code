import { TRPCError, tracked } from '@trpc/server'
import { z } from 'zod'
import { BaseMessage, HumanMessage, filterMessages } from '@langchain/core/messages'
// @ts-ignore -- Types are needed so router compiles
import { TrackedData } from '@trpc/server/unstable-core-do-not-import'
import { procedure, router } from './trpc'
import type { Message } from '@langchain/langgraph-sdk'
import type { AgentState } from '@/graphs/agent'
import type { StreamEvent } from '@langchain/core/types/stream'
import { db } from '@/db'

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

const toMessageUnion = (message: BaseMessage): Message => {
  return { ...message.toDict().data, type: message.type } as Message
}

function serializeMessages(messages: Array<BaseMessage>): Array<Message> {
  return filterMessages(messages.filter(BaseMessage.isInstance), {
    excludeTypes: ['system'],
  }).map(toMessageUnion)
}

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

type ThreadRow = {
  thread_id: string
  created_at: string
}

type RunRow = {
  run_id: string
}

type RunBuffer = {
  events: Array<SerializedStreamEvent>
  ac: AbortController
  isComplete: boolean
  notify: () => void
  nextEventPromise: () => Promise<void>
}

function createRunBuffer(ac: AbortController): RunBuffer {
  const waiters: Array<() => void> = []
  return {
    events: [],
    ac,
    isComplete: false,
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
// Maps threadId → active runId to guard against duplicate mode='new' subscriptions
const threadRunMap = new Map<string, string>()

const threadsRouter = router({
  delete: procedure.input(z.object({ threadId: z.string() })).mutation(({ input }) => {
    db.prepare('DELETE FROM threads WHERE thread_id = ?').run(input.threadId)
    return { ok: true }
  }),

  create: procedure
    .input(z.object({ projectPath: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const threadId = crypto.randomUUID()
      db.prepare('INSERT INTO threads (thread_id) VALUES (?)').run(threadId)

      await ctx.graph.updateState(
        {
          configurable: { thread_id: threadId },
        },
        {
          projectPath: input.projectPath,
        }
      )

      return { threadId }
    }),

  list: procedure.query(async ({ ctx }) => {
    const rows = db
      .prepare('SELECT thread_id, created_at FROM threads ORDER BY created_at DESC')
      .all() as Array<ThreadRow>
    return {
      threads: await Promise.all(
        rows.map(async r => {
          const state = await ctx.graph.getState({
            configurable: { thread_id: r.thread_id },
          })

          const values: AgentState = state.values

          return {
            threadId: r.thread_id,
            projectPath: values.projectPath,
            createdAt: r.created_at,
            firstMessage: values.messages.find(m => HumanMessage.isInstance(m))?.text,
          }
        })
      ),
    }
  }),

  get: procedure.input(z.object({ threadId: z.string() })).query(async ({ input, ctx }) => {
    const row = db.prepare('SELECT thread_id FROM threads WHERE thread_id = ?').get(input.threadId)
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
    const state = await ctx.graph.getState({
      configurable: { thread_id: input.threadId },
    })

    const values: AgentState = state.values

    const filteredMessages = filterMessages(values.messages, {
      excludeTypes: ['system'],
    })

    const messages = filteredMessages.map(toMessageUnion)

    return {
      ...values,
      messages,
    }
  }),
})

const runsRouter = router({
  get: procedure.input(z.object({ threadId: z.string() })).query(({ input }) => {
    const row = db
      .prepare('SELECT run_id FROM runs WHERE thread_id = ? AND status = ? LIMIT 1')
      .get(input.threadId, 'running') as RunRow | undefined
    return { activeRunId: row?.run_id ?? null }
  }),

  stream: procedure
    .input(
      z.discriminatedUnion('mode', [
        z.object({ threadId: z.string(), mode: z.literal('new'), input: z.string() }),
        z.object({ threadId: z.string(), mode: z.literal('resume'), runId: z.string() }),
      ])
    )
    .subscription(async function* ({ input, ctx }) {
      const { threadId } = input

      let runId: string
      let buffer: RunBuffer

      if (input.mode === 'new') {
        // Guard against double-invocation (React Strict Mode, reconnects, etc.)
        const existingRunId = threadRunMap.get(threadId)
        const existingBuffer = existingRunId ? runBuffers.get(existingRunId) : undefined
        if (existingBuffer && !existingBuffer.isComplete && !existingBuffer.ac.signal.aborted) {
          // Attach to the already-running execution instead of starting a second one
          runId = existingRunId!
          buffer = existingBuffer
        } else {
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
                { messages: [{ type: 'human', content: [{ type: 'text', text: input.input }] }] },
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
              threadRunMap.delete(threadId)
              setTimeout(() => runBuffers.delete(runId), 60_000)
            }
          })()
        }
      } else {
        runId = input.runId
        const existing = runBuffers.get(runId)
        // If the buffer is gone or already finished, nothing to replay — the client
        // already received all events during the original subscription.
        if (!existing || existing.isComplete) return
        buffer = existing
      }

      // Tail the buffer. Works for both 'new' and 'resume'.
      // Register the waiter BEFORE draining to avoid a race where notify fires
      // between the drain loop exiting and nextEventPromise being called.
      let idx = 0
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

export const appRouter = router({
  threads: threadsRouter,
  runs: runsRouter,
})
export type AppRouter = typeof appRouter
