import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import Fuse from 'fuse.js'

/**
 * Creates a LangGraph tool for fuzzy searching through project files.
 *
 * @param projectFiles - Array of file paths relative to the project root
 * @returns A LangGraph tool that performs fuzzy search on file paths
 */
export function fuzzyFileSearchTool(projectFiles: Array<string>) {
  const fuzzySearchSchema = z.object({
    query: z
      .string()
      .describe(
        'The search query to find files. Can be a partial filename, path segment, or loosely related term.'
      ),
    limit: z.number().optional().default(10).describe('Maximum number of results to return'),
  })

  type FuzzySearchInput = z.infer<typeof fuzzySearchSchema>

  // Configure Fuse.js for file path searching
  // We search on the full path, so partial matches work well
  const fuse = new Fuse(projectFiles, {
    keys: [], // Search directly on the file path strings
    threshold: 0.4, // Lower threshold = more strict matching (0.0 = exact, 1.0 = match anything)
    includeScore: true,
    minMatchCharLength: 1,
  })

  return tool(
    (input: FuzzySearchInput) => {
      try {
        const { query, limit } = input

        if (projectFiles.length === 0) {
          return 'No files available to search. The project file index may not be initialized.'
        }

        // Perform fuzzy search
        const results = fuse.search(query, {
          limit: limit,
        })

        if (results.length === 0) {
          return `No files found matching "${query}". Try a different search term or check the spelling.`
        }

        // Format results with scores for relevance
        const formattedResults = results.map((result, index) => {
          const score = result.score ?? 1
          const relevance = score < 0.3 ? 'high' : score < 0.5 ? 'medium' : 'low'
          return `${index + 1}. ${result.item} (relevance: ${relevance})`
        })

        const resultText = formattedResults.join('\n')
        const countText =
          results.length === limit && results.length < projectFiles.length
            ? `${results.length} (showing top ${limit} matches)`
            : `${results.length}`

        return `Found ${countText} file(s) matching "${query}":\n\n${resultText}`
      } catch (error) {
        if (error instanceof Error) {
          return `Error searching files: ${error.message}`
        }
        return `Error searching files: ${String(error)}`
      }
    },
    {
      name: 'fuzzy_file_search',
      description:
        "Perform fuzzy search on project file paths. Use this FIRST when you only have a filename (e.g., 'file-read.ts') to find the correct relative path. Useful when the user mentions a file loosely or with partial/incorrect names. Returns a list of matching file paths with relevance scores.",
      schema: fuzzySearchSchema,
    }
  )
}
