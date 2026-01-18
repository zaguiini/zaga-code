import { tool } from '@langchain/core/tools'
import { OllamaEmbeddings } from '@langchain/ollama'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, inArray } from 'drizzle-orm'
import { getVecDatabase, getVecDatabaseName } from '@/db/vec-init'
import { projectEmbeddingsTable } from '@/db/schema'

/**
 * Creates a LangGraph tool for semantic file search using RAG with SQLite storage.
 * This tool reads embeddings from the SQLite database instead of memory.
 *
 * @param projectPath - The root path of the project directory
 * @returns A LangGraph tool that performs semantic search on file contents
 */
export function createRAGFileSearchToolSQLite(projectPath: string) {
  const db = getVecDatabase()
  const drizzleDb = drizzle({ client: db })
  const tableName = getVecDatabaseName(projectPath)

  // Initialize embeddings using Ollama (same model as used for indexing)
  const embeddings = new OllamaEmbeddings({
    model: 'nomic-embed-text',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  })

  const ragSearchSchema = z.object({
    query: z
      .string()
      .describe(
        'Semantic search query describing what you are looking for. Examples: "authentication logic", "database connection setup", "API route handlers", "React component for user profile". This searches file CONTENTS, not just filenames.'
      ),
    limit: z
      .number()
      .optional()
      .default(5)
      .describe('Maximum number of results to return (default: 5)'),
  })

  type RAGSearchInput = z.infer<typeof ragSearchSchema>

  return tool(
    async (input: RAGSearchInput) => {
      try {
        const { query, limit } = input

        // Check if there are any embeddings for this project
        const existingEmbeddings = await drizzleDb
          .select()
          .from(projectEmbeddingsTable)
          .where(eq(projectEmbeddingsTable.projectPath, projectPath))
          .limit(1)

        if (existingEmbeddings.length === 0) {
          return 'No files have been indexed for semantic search. Please run the project-setup graph first to index the project.'
        }

        // Generate embedding for the query
        const queryEmbedding = await embeddings.embedQuery(query)

        // Convert to Float32Array buffer
        const queryEmbeddingBuffer = new Float32Array(queryEmbedding).buffer
        const queryEmbeddingBlob = new Uint8Array(queryEmbeddingBuffer)

        // Perform KNN search using vec0 MATCH operator
        // vec0 supports MATCH for efficient KNN search with the distance metric specified in table creation
        const searchQuery = `
          SELECT 
            rowid,
            distance
          FROM ${tableName}
          WHERE embedding MATCH ?
          LIMIT ?
        `

        const results = db.prepare(searchQuery).all(queryEmbeddingBlob, limit) as Array<{
          rowid: number
          distance: number
        }>

        if (results.length === 0) {
          return `No relevant files found for query: "${query}". Try rephrasing your search or using fuzzy_file_search for filename-based search.`
        }

        // Get the rowids and fetch corresponding metadata from project_embeddings
        const rowids = results.map(r => r.rowid)

        // Create a map of rowid to distance for quick lookup
        const distanceMap = new Map(results.map(r => [r.rowid, r.distance]))

        // Fetch all embeddings for these rowids in one query
        const allEmbeddingsData = await drizzleDb
          .select()
          .from(projectEmbeddingsTable)
          .where(eq(projectEmbeddingsTable.projectPath, projectPath))
          .where(inArray(projectEmbeddingsTable.vecRowid, rowids))

        // Combine with distances and sort by distance
        const allEmbeddings = allEmbeddingsData
          .map(data => ({
            ...data,
            distance: distanceMap.get(data.vecRowid) ?? Infinity,
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, limit)

        if (allEmbeddings.length === 0) {
          return `No relevant files found for query: "${query}". Try rephrasing your search or using fuzzy_file_search for filename-based search.`
        }

        // Format results with file paths and content snippets
        const formattedResults = allEmbeddings.map((result, index) => {
          const file = result.file
          const content = result.content
          // Truncate content if too long
          const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content

          return `${index + 1}. ${file}\n   Content snippet:\n   ${snippet
            .split('\n')
            .map(line => `   ${line}`)
            .join('\n')}`
        })

        const resultText = formattedResults.join('\n\n')
        const fileCount = new Set(allEmbeddings.map(r => r.file)).size

        return `Found ${allEmbeddings.length} relevant content chunk(s) across ${fileCount} file(s) for "${query}":\n\n${resultText}\n\nUse file_read to read the full contents of any file.`
      } catch (error) {
        if (error instanceof Error) {
          return `Error performing semantic search: ${error.message}`
        }
        return `Error performing semantic search: ${String(error)}`
      }
    },
    {
      name: 'rag_file_search',
      description:
        'Semantic search through file CONTENTS using RAG (Retrieval-Augmented Generation). Use this when you need to find files based on what they contain, not just their names. Examples: "where is the authentication code?", "find database connection logic", "search for API endpoints". This is more powerful than fuzzy_file_search which only searches filenames.',
      schema: ragSearchSchema,
    }
  )
}
