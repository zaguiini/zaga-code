import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'

const execFileAsync = promisify(execFile)

export const grepSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  glob: z.string().optional().describe('File glob to limit search, e.g. "**/*.ts" or "src/**"'),
  case_insensitive: z.boolean().optional().default(false),
})

type GrepInput = z.infer<typeof grepSchema>

async function executeGrep(input: GrepInput, projectPath: string) {
  const args = [
    '--line-number',
    '--with-filename',
    '--max-count',
    '50',
    '--max-filesize',
    '1M',
    input.case_insensitive ? '--ignore-case' : null,
    '--glob',
    '!node_modules',
    '--glob',
    '!.git',
    '--glob',
    '!dist',
    '--glob',
    '!build',
    input.glob ? ['--glob', input.glob] : null,
    input.pattern,
    '.',
  ]
    .flat()
    .filter(Boolean) as Array<string>

  try {
    const { stdout } = await execFileAsync('rg', args, {
      cwd: projectPath,
      maxBuffer: 2 * 1024 * 1024,
    })

    const lines = stdout.trim().split('\n').filter(Boolean)
    if (lines.length === 0) {
      return { pattern: input.pattern, matches: [] as Array<string>, summary: 'No matches found.' }
    }

    return {
      pattern: input.pattern,
      matches: lines,
      truncated: lines.length === 50,
    }
  } catch (error) {
    const err = error as { code?: number; message?: string }
    if (err.code === 1) {
      return { pattern: input.pattern, matches: [] as Array<string>, summary: 'No matches found.' }
    }
    return `Search error: ${err.message ?? String(error)}`
  }
}

export const grepTool: RuntimeToolDefinition<GrepInput> = {
  name: 'grep',
  description:
    'Search file contents with a regex pattern. Returns filename:line:match strings and is capped at 50 matches.',
  inputSchema: grepSchema,
  execute: async (input, ctx) => executeGrep(input, ctx.projectPath),
}
