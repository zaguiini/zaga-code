import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { z } from 'zod'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { checkShellSafety } from '@/utils/shell-safety'

const execAsync = promisify(exec)

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

/**
 * Creates a LangGraph tool for executing shell commands.
 * Commands are executed in the project directory context.
 *
 * @param projectPath - The root path of the project directory (used as cwd)
 * @returns A LangGraph tool that executes shell commands
 */
export const shellTool = tool(
  async (
    input: z.infer<typeof shellSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    try {
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
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: resolvedProjectPath,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      })

      // Combine stdout and stderr, indicating which is which
      let output = ''
      if (stdout) {
        output += `STDOUT:\n${stdout}`
      }
      if (stderr) {
        output += output ? `\n\nSTDERR:\n${stderr}` : `STDERR:\n${stderr}`
      }

      return output || 'Command executed successfully (no output)'
    } catch (error: any) {
      // execAsync throws an error with stdout/stderr properties
      let errorMessage = `Command failed: ${error.message}`
      if (error.stdout) {
        errorMessage += `\n\nSTDOUT:\n${error.stdout}`
      }
      if (error.stderr) {
        errorMessage += `\n\nSTDERR:\n${error.stderr}`
      }
      return errorMessage
    }
  },
  {
    name: 'shell',
    description:
      'Execute a shell command in the project directory. Captures both stdout and stderr. Commands referencing node_modules are blocked. Destructive commands require confirmation via the confirmed parameter.',
    schema: shellSchema,
  }
)
