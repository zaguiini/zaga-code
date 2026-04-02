import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'
import { validatePath } from '@/utils/validate-path'

const fileEditSchema = z.object({
  path: z.string().describe('Relative path to the file to edit'),
  old_string: z
    .string()
    .describe('Exact string to replace. Must match exactly, including whitespace and indentation.'),
  new_string: z.string().describe('Replacement string'),
})

const contextSchema = z.object({ project_path: z.string() })

export const fileEditTool = tool(
  async (
    input,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    const validatedPath = validatePath(input.path, project_path)
    const content = await readFile(validatedPath, 'utf-8')

    const occurrences = content.split(input.old_string).length - 1
    if (occurrences === 0) {
      return `Error: old_string not found in ${input.path}. Check for exact whitespace/indentation match.`
    }
    if (occurrences > 1) {
      return `Error: old_string appears ${occurrences} times in ${input.path}. Provide more context to make it unique.`
    }

    const updated = content.replace(input.old_string, input.new_string)
    await writeFile(validatedPath, updated, 'utf-8')
    return `Edited ${input.path}`
  },
  {
    name: 'file_edit',
    description:
      'Make a surgical edit to a file by replacing an exact string. Use this instead of file_write when modifying existing files. old_string must match exactly — include surrounding lines for uniqueness if needed.',
    schema: fileEditSchema,
  }
)
