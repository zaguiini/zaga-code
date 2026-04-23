import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { resolve } from 'node:path'
import { z } from 'zod'
import { tool } from 'langchain'
import { getCurrentTaskInput } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import type { ToolContext } from '@/runtime/tool-context'
import { checkShellSafety } from '@/utils/shell-safety'

const shellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  confirmed: z
    .boolean()
    .optional()
    .describe('Set to true to confirm execution of a destructive command'),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

type ShellInput = z.infer<typeof shellSchema>

export async function* shellHandler(input: ShellInput, ctx: ToolContext) {
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

  const resolvedProjectPath = resolve(ctx.projectPath)
  const child = spawn('sh', ['-c', input.command], {
    cwd: resolvedProjectPath,
    env: process.env,
  })

  // Merge stdout + stderr into a single async-iterable stream
  const merged = new PassThrough()
  child.stdout.pipe(merged)
  child.stderr.pipe(merged)

  let exitCode = 0
  child.on('close', code => {
    exitCode = code ?? 0
    merged.end()
  })
  child.on('error', err => merged.destroy(err))

  let accumulated = ''
  for await (const chunk of merged) {
    accumulated += chunk.toString()
    yield accumulated
  }

  if (exitCode !== 0) {
    return `Command failed (exit code ${exitCode})${accumulated ? `\n\n${accumulated}` : ''}`
  }

  return accumulated || 'Command executed successfully (no output)'
}

export const shellTool = tool(
  async function* (input: ShellInput) {
    const { projectPath } = getCurrentTaskInput<AgentState>()
    return yield* shellHandler(input, {
      threadId: '',
      projectPath,
      toolCallId: '',
      runScope: { runId: '', depth: 0 },
    })
  },
  {
    name: 'shell',
    description:
      'Execute a shell command in the project directory. Captures both stdout and stderr. Commands referencing node_modules are blocked. Destructive commands require confirmation via the confirmed parameter.',
    schema: shellSchema,
  }
)
