import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'
import type { RuntimeToolOutput } from '@/runtime/tool-output'
import { checkShellSafety } from '@/utils/shell-safety'

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const shellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  confirmed: z
    .boolean()
    .optional()
    .describe('Set to true to confirm execution of a destructive command'),
})

type ShellInput = z.infer<typeof shellSchema>

async function* executeShell(
  input: ShellInput,
  projectPath: string
): AsyncGenerator<string, RuntimeToolOutput, void> {
  if (input.command.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
    return {
      content: `Command blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`,
      metadata: { command: input.command, ok: false },
    }
  }

  const safety = checkShellSafety(input.command)

  if (safety === 'block') {
    return {
      content: `Blocked: "${input.command}" matches a permanently blocked pattern.`,
      metadata: { command: input.command, ok: false, blocked: true },
    }
  }

  if (safety === 'confirm' && !input.confirmed) {
    return {
      content: `CONFIRMATION_REQUIRED: "${input.command}" is a destructive command. Re-run with confirmed: true to execute.`,
      metadata: { command: input.command, ok: false, requiresConfirmation: true },
    }
  }

  const resolvedProjectPath = resolve(projectPath)
  const child = spawn('sh', ['-c', input.command], {
    cwd: resolvedProjectPath,
    env: process.env,
  })

  const merged = new PassThrough()
  child.stdout.pipe(merged)
  child.stderr.pipe(merged)

  const exitCodePromise = new Promise<number>((resolveExit, rejectExit) => {
    child.on('close', code => {
      merged.end()
      resolveExit(code ?? 0)
    })

    child.on('error', error => {
      merged.destroy(error)
      rejectExit(error)
    })
  })

  let accumulated = ''

  try {
    for await (const chunk of merged) {
      const text = chunk.toString()
      accumulated += text
      yield text
    }

    const exitCode = await exitCodePromise
    if (exitCode !== 0) {
      return {
        content: `Command failed (exit code ${exitCode})${accumulated ? `\n\n${accumulated}` : ''}`,
        metadata: { command: input.command, ok: false, exitCode },
      }
    }

    return {
      content: accumulated || 'Command executed successfully (no output)',
      metadata: { command: input.command, ok: true, exitCode: 0 },
    }
  } catch (error) {
    return {
      content: `Command failed: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { command: input.command, ok: false },
    }
  }
}

export const shellTool: RuntimeToolDefinition<ShellInput, string> = {
  name: 'shell',
  description:
    'Execute a shell command in the project directory. Captures stdout and stderr. Destructive commands require confirmed=true.',
  inputSchema: shellSchema,
  execute: (input, ctx) => executeShell(input, ctx.projectPath),
}
