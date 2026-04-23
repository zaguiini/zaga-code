import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'
import { validatePath } from '@/utils/validate-path'

export const fileEditSchema = z.object({
  path: z.string().describe('Relative path to the file to edit'),
  old_string: z
    .string()
    .describe('Exact string to replace. Must match exactly, including whitespace and indentation.'),
  new_string: z.string().describe('Replacement string'),
})

type FileEditInput = z.infer<typeof fileEditSchema>

async function executeFileEdit(input: FileEditInput, projectPath: string) {
  const validatedPath = validatePath(input.path, projectPath)
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
  return { ok: true, path: input.path }
}

export const fileEditTool: RuntimeToolDefinition<FileEditInput> = {
  name: 'file_edit',
  description:
    'Make a surgical edit to a file by replacing an exact string. Use this instead of file_write when modifying existing files. old_string must match exactly.',
  inputSchema: fileEditSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file to edit' },
      old_string: {
        type: 'string',
        description:
          'Exact string to replace. Must match exactly, including whitespace and indentation.',
      },
      new_string: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  execute: async (input, ctx) => executeFileEdit(input, ctx.projectPath),
}
