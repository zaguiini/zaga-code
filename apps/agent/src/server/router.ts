import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { BaseMessage, HumanMessage, filterMessages } from '@langchain/core/messages'
import type { Message } from '@langchain/langgraph-sdk'
import type { AgentState } from '@/graphs/agent'
import type { StreamEvent } from '@langchain/core/types/stream'
import { procedure, router } from '@/server/trpc'
import { db } from '@/db'

const toMessageUnion = (message: BaseMessage) => {
  return { ...message.toDict().data, type: message.type } as Message
}

function serializeMessages(messages: Array<BaseMessage>): Array<Message> {
  return filterMessages(messages.filter(BaseMessage.isInstance), {
    excludeTypes: ['system'],
  }).map(toMessageUnion)
}

function serializeEvent(event: StreamEvent) {
  const data = event.data

  switch (event.event) {
    case 'on_chat_model_stream': {
      const chunk = data.chunk
      if (!BaseMessage.isInstance(chunk)) return event
      return { ...event, data: { ...data, chunk: toMessageUnion(chunk) } }
    }
    case 'on_chain_start': {
      const input = data.input
      if (!Array.isArray(input?.messages)) return event
      return {
        ...event,
        data: { ...data, input: { ...input, messages: serializeMessages(input.messages) } },
      }
    }
    case 'on_chain_end': {
      const output = data.output
      if (!Array.isArray(output?.messages)) return event
      return {
        ...event,
        data: { ...data, output: { ...output, messages: serializeMessages(output.messages) } },
      }
    }
    default:
      return event
  }
}

type ThreadRow = {
  thread_id: string
  created_at: string
}

const abortControllers = new Map<string, AbortController>()

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
  stream: procedure
    .input(z.object({ threadId: z.string(), input: z.string() }))
    .subscription(async function* ({ input, ctx }) {
      const ac = new AbortController()
      abortControllers.set(input.threadId, ac)

      try {
        const eventStream = ctx.graph.streamEvents(
          {
            messages: [{ type: 'human', content: [{ type: 'text', text: input.input }] }],
          },
          {
            subgraphs: true,
            version: 'v2',
            configurable: { thread_id: input.threadId },
            signal: ac.signal,
          }
        )

        for await (const event of eventStream) {
          yield serializeEvent(event)
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') throw err
      } finally {
        abortControllers.delete(input.threadId)
      }
    }),

  cancel: procedure.input(z.object({ threadId: z.string() })).mutation(({ input }) => {
    abortControllers.get(input.threadId)?.abort()
    return { ok: true }
  }),
})

export const appRouter = router({
  threads: threadsRouter,
  runs: runsRouter,
})
export type AppRouter = typeof appRouter
