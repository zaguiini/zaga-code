import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolRuntime } from '@langchain/core/tools'
import { validatePath } from '@/utils/validate-path'

const fileWriteSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to write, must be within the project directory'),
  content: z.string().describe('Content to write to the file'),
})

const stateSchema = z.object({
  projectPath: z.string(),
})

/**
 * Creates a LangGraph tool for writing/creating files with path validation.
 * Automatically creates parent directories if they don't exist.
 *
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that writes files within the project directory
 */
export const fileWriteTool = tool(
  async (
    input: z.infer<typeof fileWriteSchema>,
    { state: { projectPath } }: ToolRuntime<z.infer<typeof stateSchema>>
  ) => {
    try {
      const validatedPath = validatePath(input.path, projectPath)
      const directory = dirname(validatedPath)

      // Create parent directories if they don't exist
      await mkdir(directory, { recursive: true })

      // Write the file
      await writeFile(validatedPath, input.content, 'utf-8')

      return `Successfully wrote file: ${input.path}`
    } catch (error) {
      if (error instanceof Error) {
        return `Error writing file: ${error.message}`
      }
      return `Error writing file: ${String(error)}`
    }
  },
  {
    name: 'file_write',
    description:
      'Write or create a file within the project directory. Automatically creates parent directories if needed. The path must be relative to the project root.',
    schema: fileWriteSchema,
  }
)
