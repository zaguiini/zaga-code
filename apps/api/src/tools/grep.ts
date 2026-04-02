import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'

const execFileAsync = promisify(execFile)

const grepSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  glob: z.string().optional().describe('File glob to limit search, e.g. "**/*.ts" or "src/**"'),
  case_insensitive: z.boolean().optional().default(false),
})

const contextSchema = z.object({ project_path: z.string() })

export const grepTool = tool(
  async (
    input,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
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
        cwd: project_path,
        maxBuffer: 2 * 1024 * 1024,
      })
      const lines = stdout.trim().split('\n').filter(Boolean)
      if (lines.length === 0) return `No matches for "${input.pattern}"`
      const capped = lines.length === 50 ? `\n(limited to 50 results)` : ''
      return lines.join('\n') + capped
    } catch (err: any) {
      if (err.code === 1) return `No matches for "${input.pattern}"`
      return `Search error: ${err.message}`
    }
  },
  {
    name: 'grep',
    description:
      'Search file contents using a regex pattern. Returns filename:line:match format. Use glob to limit to specific file types (e.g. "**/*.ts"). Prefer this over shell+grep for structured results.',
    schema: grepSchema,
  }
)
