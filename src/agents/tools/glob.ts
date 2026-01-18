import { resolve } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { glob } from 'glob'

/**
 * Creates a LangGraph tool for finding files matching a glob pattern with path validation.
 *
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that finds files matching a pattern within the project directory
 */
export function globTool(projectPath: string) {
  const globSchema = z.object({
    pattern: z
      .string()
      .describe(
        "The glob pattern to match files (e.g., '*.ts', '**/*.ts', 'src/**/*.tsx', or a specific file path)"
      ),
    maxFiles: z.number().optional().default(100).describe('Maximum number of files to return'),
  })

  type GlobInput = z.infer<typeof globSchema>

  return tool(
    async (input: GlobInput) => {
      try {
        const pattern = input.pattern
        const maxFiles = input.maxFiles
        const resolvedProjectPath = resolve(projectPath)

        // Use glob package with projectPath as cwd
        const files = await glob(pattern, {
          cwd: resolvedProjectPath,
          absolute: false, // Return relative paths
          ignore: ['node_modules/**', '.git/**'], // Ignore common directories
        })

        // Limit results if needed
        const limitedFiles = files.slice(0, maxFiles)

        if (limitedFiles.length === 0) {
          return `No files found matching pattern: ${pattern}`
        }

        // Format results
        const fileList = limitedFiles.join('\n')
        const fileCount = limitedFiles.length
        const fileCountText =
          fileCount === maxFiles && files.length > maxFiles
            ? `${fileCount} (limited by maxFiles, ${files.length} total found)`
            : `${fileCount}`

        return `Found ${fileCountText} file(s) matching pattern "${pattern}":\n\n${fileList}`
      } catch (error) {
        if (error instanceof Error) {
          return `Error finding files: ${error.message}`
        }
        return `Error finding files: ${String(error)}`
      }
    },
    {
      name: 'glob',
      description:
        'Find files matching a glob pattern within the project directory. Supports patterns like *.ts, **/*.ts, src/**/*.tsx, or specific file paths. Returns a list of matching file paths relative to the project root.',
      schema: globSchema,
    }
  )
}
