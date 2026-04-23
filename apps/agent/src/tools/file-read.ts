import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'
import { validatePath } from '@/utils/validate-path'

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const fileReadSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to read, must be within the project directory'),
})

type FileReadInput = z.infer<typeof fileReadSchema>

async function executeFileRead(input: FileReadInput, projectPath: string) {
  if (input.path.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
    return `Path blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
  }

  const validatedPath = validatePath(input.path, projectPath)
  const content = await readFile(validatedPath, 'utf-8')
  const extension = path.extname(input.path).slice(1) || undefined

  return {
    path: input.path,
    content,
    format: 'code',
    ...(extension ? { language: extension } : {}),
  }
}

export const fileReadTool: RuntimeToolDefinition<FileReadInput> = {
  name: 'file_read',
  description:
    'Read the contents of a file within the project directory. The path must be relative to the project root.',
  inputSchema: fileReadSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file to read, must be within the project directory',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  execute: async (input, ctx) => executeFileRead(input, ctx.projectPath),
}
