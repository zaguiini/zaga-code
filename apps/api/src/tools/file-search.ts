import path from 'node:path'
import { z } from 'zod'
import { glob } from 'glob'
import Fuse from 'fuse.js'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'

const fileSearchSchema = z.object({
  query: z
    .string()
    .describe(
      'Search query to find files by name or path. Examples: "auth", "component", "utils.ts", "src/api". This searches file NAMES and PATHS, not file contents.'
    ),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of results to return (default: 10)'),
})

const contextSchema = z.object({
  project_path: z.string(),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const fileSearchTool = tool(
  async (
    input: z.infer<typeof fileSearchSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    try {
      const { query, limit } = input
      if (query.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
        return `Search blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
      }

      const filePaths = await glob('**/*', {
        cwd: project_path,
        nodir: true,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**'],
      })

      if (filePaths.length === 0) {
        return 'No files found in project directory.'
      }

      const files = filePaths.map(f => ({ file: path.basename(f), filePath: f }))

      const fuse = new Fuse(files, {
        keys: ['file', 'filePath'],
        threshold: 0.5,
        includeScore: true,
        minMatchCharLength: 1,
      })

      const results = fuse.search(query, { limit })

      if (results.length === 0) {
        return `No files found matching "${query}". Try a different search term.`
      }

      const formattedResults = results.map((result, index) => {
        const { filePath } = result.item
        const score = result.score ? ` (score: ${result.score.toFixed(3)})` : ''
        return `${index + 1}. ${filePath}${score}`
      })

      return `Found ${results.length} file(s) matching "${query}":\n\n${formattedResults.join('\n')}\n\nUse file_read to read the contents of any file.`
    } catch (error) {
      if (error instanceof Error) {
        return `Error performing file search: ${error.message}`
      }
      return `Error performing file search: ${String(error)}`
    }
  },
  {
    name: 'file_search',
    description:
      'Fuzzy search through file NAMES and PATHS. Use this when you need to find files by their name or path. Examples: "find auth files", "search for component.tsx", "locate utils directory". This searches file names/paths, not file contents.',
    schema: fileSearchSchema,
  }
)
