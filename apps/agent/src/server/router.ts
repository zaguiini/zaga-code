import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { procedure, router } from '@/server/trpc'
import { db } from '@/db'

type ThreadRow = {
  thread_id: string
  project_path: string
  created_at: string
  last_message: string | null
}

const abortControllers = new Map<string, AbortController>()

const threadsRouter = router({
  create: procedure.input(z.object({ projectPath: z.string() })).mutation(({ input }) => {
    const threadId = crypto.randomUUID()
    db.prepare('INSERT INTO threads (thread_id, project_path) VALUES (?, ?)').run(
      threadId,
      input.projectPath
    )
    return { threadId }
  }),

  list: procedure.query(() => {
    const rows = db
      .prepare(
        'SELECT thread_id, project_path, created_at, last_message FROM threads ORDER BY created_at DESC'
      )
      .all() as Array<ThreadRow>
    return {
      threads: rows.map(r => ({
        threadId: r.thread_id,
        projectPath: r.project_path,
        createdAt: r.created_at,
        lastMessage: r.last_message,
      })),
    }
  }),

  get: procedure.input(z.object({ threadId: z.string() })).query(async ({ input, ctx }) => {
    const row = db.prepare('SELECT thread_id FROM threads WHERE thread_id = ?').get(input.threadId)
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })
    const state = await ctx.graph.getState({
      configurable: { thread_id: input.threadId },
    })
    return {
      messages: (state.values.messages ?? []) as Array<unknown>,
      usedTokens: (state.values.usedTokens as number | undefined) ?? 0,
      maxTokens: (state.values.maxTokens as number | undefined) ?? 0,
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
            version: 'v2',
            configurable: { thread_id: input.threadId },
            signal: ac.signal,
          }
        )

        for await (const event of eventStream) {
          yield event
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') throw err
      } finally {
        db.prepare('UPDATE threads SET last_message = ? WHERE thread_id = ?').run(
          input.input.slice(0, 100),
          input.threadId
        )
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
