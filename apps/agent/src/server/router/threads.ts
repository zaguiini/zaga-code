import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { HumanMessage, filterMessages } from '@langchain/core/messages'
import { procedure, router } from '../trpc'
import type { AgentState } from '@/graphs/agent'
import { db } from '@/db'
import { toMessageUnion } from '@/utils/messages'
import { listProjectFiles } from '@/utils/list-project-files'

type ThreadRow = {
  thread_id: string
  created_at: string
}

type MessageContentPart = {
  type: string
  text?: string
  image_url?: {
    url?: string
  }
}

const threadFilesInputSchema = z
  .object({
    threadId: z.string().optional(),
    projectPath: z.string().optional(),
  })
  .refine(input => Number(Boolean(input.threadId)) + Number(Boolean(input.projectPath)) === 1, {
    message: 'Provide exactly one of threadId or projectPath.',
  })

function getMessageContentParts(content: unknown): Array<MessageContentPart> {
  return Array.isArray(content) ? content : []
}

function getFirstMessageSummary(message: HumanMessage | undefined): string | undefined {
  if (!message) return undefined

  const text = message.text.trim()
  if (text) return text

  const imageCount = getMessageContentParts(message.content).filter(
    (part): part is MessageContentPart & { image_url: { url: string } } =>
      part.type === 'image_url' && typeof part.image_url?.url === 'string'
  ).length

  if (imageCount > 0) {
    return imageCount === 1 ? '[Image]' : '[Images]'
  }

  return undefined
}

function buildFolderList(files: Array<string>): Array<string> {
  const folders = new Set<string>()

  for (const file of files) {
    const parts = file.split('/')
    if (parts.length <= 1) continue

    for (let index = 1; index < parts.length; index++) {
      folders.add(parts.slice(0, index).join('/'))
    }
  }

  return Array.from(folders).sort((a, b) => a.localeCompare(b))
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
          const firstHumanMessage = values.messages.find(m => HumanMessage.isInstance(m))

          return {
            threadId: r.thread_id,
            projectPath: values.projectPath,
            createdAt: r.created_at,
            firstMessage: getFirstMessageSummary(firstHumanMessage),
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

  files: procedure.input(threadFilesInputSchema).query(async ({ input, ctx }) => {
    const projectPath = input.projectPath
      ? input.projectPath
      : await (async () => {
          const row = db
            .prepare('SELECT thread_id FROM threads WHERE thread_id = ?')
            .get(input.threadId) as ThreadRow | undefined
          if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })

          const state = await ctx.graph.getState({
            configurable: { thread_id: input.threadId! },
          })
          const values: AgentState = state.values
          return values.projectPath
        })()

    if (!projectPath) return { files: [], folders: [] }

    const files = await listProjectFiles(projectPath)
    const folders = buildFolderList(files)
    return { files, folders }
  }),
})
