import { tracked } from '@trpc/server'
import { z } from 'zod'
import { procedure, router } from '../trpc'
import type { AgentRuntime } from '@/runtime/agent-runtime'
import type { SerializedStreamEventV2 } from '@/runtime/events'
import { db } from '@/db'
import { getThreadState, patchThreadState } from '@/runtime/state-store'

type RunRow = {
  run_id: string
}

const runImageSchema = z.object({
  name: z.string(),
  mimeType: z.string().startsWith('image/'),
  url: z.string().startsWith('data:image/'),
})

const runInputSchema = z.object({
  text: z.string(),
  images: z.array(runImageSchema).default([]),
})

type RunBuffer<TEvent> = {
  events: Array<TEvent>
  ac: AbortController
  isComplete: boolean
  subscribers: number
  notify: () => void
  nextEventPromise: () => Promise<void>
}

function createRunBuffer<TEvent>(ac: AbortController): RunBuffer<TEvent> {
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

const runBuffers = new Map<string, RunBuffer<SerializedStreamEventV2>>()
const threadRunMap = new Map<string, string>()

function maybeCleanupBuffer(
  runId: string,
  threadId: string,
  buffer: RunBuffer<SerializedStreamEventV2>
) {
  if (buffer.isComplete && buffer.subscribers === 0) {
    runBuffers.delete(runId)
    threadRunMap.delete(threadId)
  }
}

function startRunV2(
  input: { threadId: string; input: z.infer<typeof runInputSchema> },
  runtime: AgentRuntime<SerializedStreamEventV2>
) {
  const { threadId } = input
  const text = input.input.text.trim()
  if (!text && input.input.images.length === 0) return null

  const runId = crypto.randomUUID()
  db.prepare('INSERT INTO runs (run_id, thread_id, status) VALUES (?, ?, ?)').run(
    runId,
    threadId,
    'running'
  )

  const ac = new AbortController()
  const buffer = createRunBuffer<SerializedStreamEventV2>(ac)
  runBuffers.set(runId, buffer)
  threadRunMap.set(threadId, runId)

  const current = getThreadState(threadId)
  const humanMessage = {
    id: crypto.randomUUID(),
    type: 'human' as const,
    content: [
      ...(text ? [{ type: 'text', text }] : []),
      ...input.input.images.map(image => ({
        type: 'image_url',
        image_url: { url: image.url },
        name: image.name,
      })),
    ],
  }
  const updatedState = patchThreadState(threadId, { messages: [...current.messages, humanMessage] })

  void (async () => {
    try {
      const stream = runtime.stream(
        {
          threadId,
          projectPath: updatedState.projectPath,
          text,
          images: input.input.images,
          messages: updatedState.messages,
        },
        { signal: ac.signal }
      )

      for await (const event of stream) {
        buffer.events.push(event)
        buffer.notify()

        if (event.type === 'assistant.completed') {
          const state = getThreadState(threadId)
          patchThreadState(threadId, {
            messages: [...state.messages, event.message],
          })
        }

        if (event.type === 'run.completed') {
          patchThreadState(threadId, event.finalState)
        }
      }

      db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run('completed', runId)
    } catch {
      db.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run('failed', runId)
    } finally {
      buffer.isComplete = true
      buffer.notify()
      maybeCleanupBuffer(runId, threadId, buffer)
    }
  })()

  return { runId }
}

export const runsRouter = router({
  get: procedure.input(z.object({ threadId: z.string() })).query(({ input }) => {
    const row = db
      .prepare('SELECT run_id FROM runs WHERE thread_id = ? AND status = ? LIMIT 1')
      .get(input.threadId, 'running') as RunRow | undefined
    return { activeRunId: row?.run_id ?? null }
  }),

  startV2: procedure
    .input(
      z.object({
        threadId: z.string(),
        input: runInputSchema,
      })
    )
    .mutation(({ input, ctx }) => {
      const existingRunId = threadRunMap.get(input.threadId)
      const existingBuffer = existingRunId ? runBuffers.get(existingRunId) : undefined
      if (existingBuffer && !existingBuffer.isComplete && !existingBuffer.ac.signal.aborted) {
        return { runId: existingRunId }
      }

      const started = startRunV2(input, ctx.runtime)
      if (!started) {
        return { runId: null }
      }

      return started
    }),

  streamV2: procedure
    .input(
      z.object({
        threadId: z.string(),
        runId: z.string().optional(),
        lastEventId: z.string().nullish(),
      })
    )
    .subscription(async function* ({ input }) {
      const { threadId } = input

      let runId: string | undefined
      let buffer: RunBuffer<SerializedStreamEventV2> | undefined
      let startIdx = 0

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
            return
          }
        }
      }

      if (!buffer && input.runId) {
        const requestedBuffer = runBuffers.get(input.runId)
        if (requestedBuffer) {
          runId = input.runId
          buffer = requestedBuffer
        }
      }

      if (!buffer) {
        const activeRunId = threadRunMap.get(threadId)
        const activeBuffer = activeRunId ? runBuffers.get(activeRunId) : undefined
        if (activeBuffer && !activeBuffer.isComplete && !activeBuffer.ac.signal.aborted) {
          runId = activeRunId
          buffer = activeBuffer
        }
      }

      if (!buffer || !runId) return

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

  cancelV2: procedure.input(z.object({ threadId: z.string() })).mutation(({ input, ctx }) => {
    const runId = threadRunMap.get(input.threadId)
    if (runId) {
      runBuffers.get(runId)?.ac.abort()
    }

    ctx.runtime.cancel(input.threadId)
    return { ok: true }
  }),
})
