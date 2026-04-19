import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { HumanMessage, filterMessages } from '@langchain/core/messages'
import { procedure, router } from '../trpc'
import type { AgentState } from '@/graphs/agent'
import { db } from '@/db'
import { toMessageUnion } from '@/utils/messages'

type ThreadRow = {
  thread_id: string
  created_at: string
}

export const threadsRouter = router({
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
