import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'
import { validatePath } from '@/utils/validate-path'

const fileReadSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to read, must be within the project directory'),
})

const contextSchema = z.object({
  project_path: z.string(),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const fileReadTool = tool(
  async (
    input: z.infer<typeof fileReadSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    try {
      if (input.path.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
        return `Path blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
      }

      const validatedPath = validatePath(input.path, project_path)
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
