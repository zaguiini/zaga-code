import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'
import { validatePath } from '@/utils/validate-path'

export const fileWriteSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to write, must be within the project directory'),
  content: z.string().describe('Content to write to the file'),
})

type FileWriteInput = z.infer<typeof fileWriteSchema>

async function executeFileWrite(input: FileWriteInput, projectPath: string) {
  const validatedPath = validatePath(input.path, projectPath)
  const directory = dirname(validatedPath)

  await mkdir(directory, { recursive: true })
  await writeFile(validatedPath, input.content, 'utf-8')

  return { ok: true, path: input.path }
}

export const fileWriteTool: RuntimeToolDefinition<FileWriteInput> = {
  name: 'file_write',
  description:
    'Write or create a file within the project directory. Automatically creates parent directories if needed. The path must be relative to the project root.',
  inputSchema: fileWriteSchema,
  execute: async (input, ctx) => executeFileWrite(input, ctx.projectPath),
}
