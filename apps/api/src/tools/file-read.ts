import { readFile } from 'node:fs/promises'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ToolRuntime } from '@langchain/core/tools'
import { validatePath } from '@/utils/validate-path'

const fileReadSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to read, must be within the project directory'),
})

const stateSchema = z.object({
  projectPath: z.string(),
})

export const fileReadTool = tool(
  async (
    input: z.infer<typeof fileReadSchema>,
    { state: { projectPath } }: ToolRuntime<z.infer<typeof stateSchema>>
  ) => {
    try {
      const validatedPath = validatePath(input.path, projectPath)
      const content = await readFile(validatedPath, 'utf-8')
      return content
    } catch (error) {
      if (error instanceof Error) {
        return `Error reading file: ${error.message}`
      }
      return `Error reading file: ${String(error)}`
    }
  },
  {
    name: 'file_read',
    description:
      'Read the contents of a file within the project directory. The path must be relative to the project root.',
    schema: fileReadSchema,
  }
)
