import { z } from 'zod'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import Fuse from 'fuse.js'
import { tool } from 'langchain'
import type { ToolRuntime } from '@langchain/core/tools'
import { projectEmbeddingsTable } from '@/db/schema'
import { DB_CONNECTION } from '@/db/constants'

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

export const fileSearchTool = tool(
  async (
    input: z.infer<typeof fileSearchSchema>,
    { context: { project_path } }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    const drizzleDb = drizzle(DB_CONNECTION)

    try {
      const { query, limit } = input

      // Get all unique file paths for this project
      const files = await drizzleDb
        .selectDistinct({
          file: projectEmbeddingsTable.file,
        })
        .from(projectEmbeddingsTable)
        .where(eq(projectEmbeddingsTable.projectPath, project_path))

      if (files.length === 0) {
        return 'No files have been indexed. Please run the project-setup graph first to index the project.'
      }

      // Configure Fuse.js for fuzzy search
      const fuse = new Fuse(files, {
        keys: ['file'],
        threshold: 0.5, // 0.0 = exact match, 1.0 = match anything (lower = more strict)
        includeScore: true,
        minMatchCharLength: 1,
      })

      // Perform fuzzy search
      const results = fuse.search(query, { limit })

      if (results.length === 0) {
        return `No files found matching "${query}". Try a different search term.`
      }

      // Format results
      const formattedResults = results.map((result, index) => {
        const { file } = result.item
        const score = result.score ? ` (score: ${result.score.toFixed(3)})` : ''
        return `${index + 1}. ${file}${score}`
      })

      const resultText = formattedResults.join('\n')

      return `Found ${results.length} file(s) matching "${query}":\n\n${resultText}\n\nUse file_read to read the contents of any file.`
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
      'Fuzzy search through file NAMES and PATHS. Use this when you need to find files by their name or path. Examples: "find auth files", "search for component.tsx", "locate utils directory". This searches file names/paths, not file contents. For searching file contents, use rag_file_search instead.',
    schema: fileSearchSchema,
  }
)
