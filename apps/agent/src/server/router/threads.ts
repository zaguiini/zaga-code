import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { procedure, router } from '../trpc'
import { db } from '@/db'
import { ensureThreadState, getThreadState } from '@/runtime/state-store'
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

function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content.trim()

  return getMessageContentParts(content)
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text ?? '')
    .join('')
    .trim()
}

function getFirstMessageSummary(message: { content: unknown } | undefined): string | undefined {
  if (!message) return undefined

  const text = getMessageText(message.content)
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
    db.prepare('DELETE FROM thread_state WHERE thread_id = ?').run(input.threadId)
    return { ok: true }
  }),

  create: procedure.input(z.object({ projectPath: z.string() })).mutation(({ input }) => {
    const threadId = crypto.randomUUID()
    db.prepare('INSERT INTO threads (thread_id) VALUES (?)').run(threadId)
    ensureThreadState(threadId, input.projectPath)

    return { threadId }
  }),

  list: procedure.query(() => {
    const rows = db
      .prepare('SELECT thread_id, created_at FROM threads ORDER BY created_at DESC')
      .all() as Array<ThreadRow>

    return {
      threads: rows.map(r => {
        const state = getThreadState(r.thread_id)
        const firstHumanMessage = state.messages.find(message => message.type === 'human')

        return {
          threadId: r.thread_id,
          projectPath: state.projectPath,
          createdAt: r.created_at,
          firstMessage: getFirstMessageSummary(firstHumanMessage),
        }
      }),
    }
  }),

  get: procedure.input(z.object({ threadId: z.string() })).query(({ input }) => {
    const row = db.prepare('SELECT thread_id FROM threads WHERE thread_id = ?').get(input.threadId)
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })

    return getThreadState(input.threadId)
  }),

  files: procedure.input(threadFilesInputSchema).query(async ({ input }) => {
    let projectPath = input.projectPath
    if (!projectPath) {
      const row = db
        .prepare('SELECT thread_id FROM threads WHERE thread_id = ?')
        .get(input.threadId) as ThreadRow | undefined
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' })

      projectPath = getThreadState(input.threadId!).projectPath
    }

    if (!projectPath) return { files: [], folders: [] }

    const files = await listProjectFiles(projectPath)
    const folders = buildFolderList(files)
    return { files, folders }
  }),
})
