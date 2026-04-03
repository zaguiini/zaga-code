import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { z } from 'zod'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { checkShellSafety } from '@/utils/shell-safety'

const shellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  confirmed: z
    .boolean()
    .optional()
    .describe('Set to true to confirm execution of a destructive command'),
})

const contextSchema = z.object({
  project_path: z.string(),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const shellTool = tool(
  async function* (
    input: z.infer<typeof shellSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) {
    if (input.command.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
      return `Command blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
    }

    const safety = checkShellSafety(input.command)

    if (safety === 'block') {
      return `Blocked: "${input.command}" matches a permanently blocked pattern.`
    }

    if (safety === 'confirm' && !input.confirmed) {
      return `CONFIRMATION_REQUIRED: "${input.command}" is a destructive command. Re-run with confirmed: true to execute.`
    }

    const resolvedProjectPath = resolve(project_path)
    const child = spawn('sh', ['-c', input.command], {
      cwd: resolvedProjectPath,
      env: process.env,
    })

    // Bridge spawn events → async iteration via a simple queue
    type QueueItem =
      | { type: 'data'; text: string; source: 'stdout' | 'stderr' }
      | { type: 'done'; exitCode: number }
      | { type: 'error'; error: Error }
    const queue: Array<QueueItem> = []
    let resolve_: (() => void) | null = null

    function push(item: QueueItem) {
      queue.push(item)
      resolve_?.()
    }

    function waitForItem(): Promise<void> {
      if (queue.length > 0) return Promise.resolve()
      return new Promise(r => {
        resolve_ = r
      })
    }

    child.stdout.on('data', (data: Buffer) =>
      push({ type: 'data', text: data.toString(), source: 'stdout' })
    )
    child.stderr.on('data', (data: Buffer) =>
      push({ type: 'data', text: data.toString(), source: 'stderr' })
    )
    child.on('error', (error: Error) => push({ type: 'error', error }))
    child.on('close', (exitCode: number | null) => push({ type: 'done', exitCode: exitCode ?? 0 }))

    let stdout = ''
    let stderr = ''
    let combined = ''

    for (;;) {
      await waitForItem()

      // Drain all queued items
      while (queue.length > 0) {
        const item = queue.shift()!

        if (item.type === 'error') {
          return `Command failed: ${item.error.message}`
        }

        if (item.type === 'done') {
          // Format final output with labels (same as original tool)
          let output = ''
          if (stdout) output += `STDOUT:\n${stdout}`
          if (stderr) output += output ? `\n\nSTDERR:\n${stderr}` : `STDERR:\n${stderr}`

          if (item.exitCode !== 0) {
            let errorMessage = `Command failed (exit code ${item.exitCode})`
            if (stdout) errorMessage += `\n\nSTDOUT:\n${stdout}`
            if (stderr) errorMessage += `\n\nSTDERR:\n${stderr}`
            return errorMessage
          }

          return output || 'Command executed successfully (no output)'
        }

        // type === 'data'
        if (item.source === 'stdout') stdout += item.text
        else stderr += item.text
        combined += item.text
        yield combined
      }
    }
  },
  {
    name: 'shell',
    description:
      'Execute a shell command in the project directory. Captures both stdout and stderr. Commands referencing node_modules are blocked. Destructive commands require confirmation via the confirmed parameter.',
    schema: shellSchema,
  }
)
