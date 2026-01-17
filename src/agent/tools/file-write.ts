import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * Validates that a file path is within the project directory
 * to prevent directory traversal attacks.
 *
 * Handles Windows cross-drive paths by checking if the resolved path
 * actually starts with the project path, rather than relying solely
 * on path.relative() which returns absolute paths for cross-drive comparisons.
 */
function validatePath(filePath: string, projectPath: string): string {
  const resolvedProjectPath = resolve(projectPath)
  const resolvedFilePath = resolve(projectPath, filePath)

  // Normalize paths for comparison (handle trailing slashes)
  const normalizedProjectPath = resolvedProjectPath.replace(/[/\\]$/, '') + '/'
  const normalizedFilePath = resolvedFilePath.replace(/[/\\]$/, '') + '/'

  // Check if the resolved file path is actually within the project directory
  // This handles Windows cross-drive paths where path.relative() returns
  // an absolute path instead of a relative one
  if (!normalizedFilePath.startsWith(normalizedProjectPath)) {
    throw new Error(`Path "${filePath}" is outside the project directory`)
  }

  return resolvedFilePath
}

/**
 * Creates a LangGraph tool for writing/creating files with path validation.
 * Automatically creates parent directories if they don't exist.
 *
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that writes files within the project directory
 */
export function fileWriteTool(projectPath: string) {
  const fileWriteSchema = z.object({
    path: z
      .string()
      .describe('Relative path to the file to write, must be within the project directory'),
    content: z.string().describe('Content to write to the file'),
  })

  return tool(
    async (input: z.infer<typeof fileWriteSchema>) => {
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
}
