import Fuse from 'fuse.js'
import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'
import { listProjectFiles } from '@/utils/list-project-files'

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const fileSearchSchema = z.object({
  query: z
    .string()
    .describe(
      'Search query to find files by name or path. This searches file names and paths, not file contents.'
    ),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of results to return (default: 10)'),
})

type FileSearchInput = z.infer<typeof fileSearchSchema>

async function executeFileSearch(input: FileSearchInput, projectPath: string) {
  const { query, limit } = input
  if (query.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
    return `Search blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
  }

  const filePaths = await listProjectFiles(projectPath)

  if (filePaths.length === 0) {
    return { query, results: [] as Array<string>, summary: 'No files found in project directory.' }
  }

  const files = filePaths.map(f => ({ file: f.split('/').pop() ?? f, filePath: f }))

  const fuse = new Fuse(files, {
    keys: ['file', 'filePath'],
    threshold: 0.5,
    includeScore: true,
    minMatchCharLength: 1,
  })

  const results = fuse.search(query, { limit })

  if (results.length === 0) {
    return {
      query,
      results: [] as Array<string>,
      summary: `No files found matching "${query}". Try a different search term.`,
    }
  }

  const formatted = results.map(result => result.item.filePath)

  return {
    query,
    results: formatted,
    summary: `Found ${formatted.length} file(s) matching "${query}".`,
  }
}

export const fileSearchTool: RuntimeToolDefinition<FileSearchInput> = {
  name: 'file_search',
  description:
    'Fuzzy search through file names and paths. Use this to locate files before reading or editing.',
  inputSchema: fileSearchSchema,
  execute: async (input, ctx) => executeFileSearch(input, ctx.projectPath),
}
