import { tool } from '@langchain/core/tools'
import { OllamaEmbeddings } from '@langchain/ollama'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/postgres-js'
import { cosineDistance, desc, eq, gt, sql } from 'drizzle-orm'
import type { ToolRuntime } from '@langchain/core/tools'
import { projectEmbeddingsTable } from '@/db/schema'
import { env } from '@/env'
import { DB_CONNECTION } from '@/db/constants'

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

const stateSchema = z.object({
  projectPath: z.string(),
})

export const ragSearchTool = tool(
  async (
    input: z.infer<typeof ragSearchSchema>,
    { state: { projectPath } }: ToolRuntime<z.infer<typeof stateSchema>>
  ) => {
    const drizzleDb = drizzle(DB_CONNECTION)

    // Initialize embeddings using Ollama (same model as used for indexing)
    const embeddings = new OllamaEmbeddings({
      model: env.RAG_MODEL,
      baseUrl: env.OLLAMA_API_URL,
    })

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

      const similarity = sql<number>`1 - (${cosineDistance(projectEmbeddingsTable.embedding, queryEmbedding)})`
      const results = await drizzleDb
        .select({
          file: projectEmbeddingsTable.file,
          content: projectEmbeddingsTable.content,
          similarity,
        })
        .from(projectEmbeddingsTable)
        .where(gt(similarity, 0.5))
        .orderBy(t => desc(t.similarity))
        .limit(limit)

      if (results.length === 0) {
        return `No relevant files found for query: "${query}". Try rephrasing your search.`
      }

      // Format results with file paths and content snippets
      const formattedResults = results.map((result, index) => {
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
      const fileCount = new Set(results.map(r => r.file)).size

      return `Found ${results.length} relevant content chunk(s) across ${fileCount} file(s) for "${query}":\n\n${resultText}\n\nUse file_read to read the full contents of any file.`
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
      'Semantic search through file CONTENTS using RAG (Retrieval-Augmented Generation). Use this when you need to find files based on what they contain, not just their names. Examples: "where is the authentication code?", "find database connection logic", "search for API endpoints".',
    schema: ragSearchSchema,
  }
)
