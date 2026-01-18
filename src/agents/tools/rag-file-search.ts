import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tool } from '@langchain/core/tools'
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory'

import { Document } from '@langchain/core/documents'
import { OllamaEmbeddings } from '@langchain/ollama'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { z } from 'zod'

/**
 * Creates a LangGraph tool for semantic file search using RAG (Retrieval-Augmented Generation).
 * This tool indexes file contents and allows semantic search based on meaning rather than just filenames.
 *
 * @param projectPath - The root path of the project directory
 * @param projectFiles - Array of file paths relative to the project root
 * @returns A LangGraph tool that performs semantic search on file contents
 */
export async function createRAGFileSearchTool(projectPath: string, projectFiles: Array<string>) {
  // Filter to only include text-based files (exclude binary files)
  const textExtensions = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.json',
    '.md',
    '.txt',
    '.css',
    '.scss',
    '.html',
    '.xml',
    '.yaml',
    '.yml',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.cpp',
    '.c',
    '.h',
    '.hpp',
    '.sql',
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.vue',
    '.svelte',
    '.php',
    '.rb',
    '.swift',
    '.kt',
    '.scala',
    '.clj',
    '.lua',
    '.r',
    '.m',
    '.mm',
  ]

  const textFiles = projectFiles.filter(file => {
    const ext = file.substring(file.lastIndexOf('.'))
    return textExtensions.includes(ext.toLowerCase())
  })

  // Initialize embeddings using Ollama
  const embeddings = new OllamaEmbeddings({
    model: 'nomic-embed-text', // Good embedding model for code
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  })

  // Initialize text splitter optimized for code
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n\n', '\n', ' ', ''], // Split on code blocks, then lines, then words
  })

  // Load and chunk documents
  const documents: Array<Document> = []
  const maxFileSize = 100 * 1024 // 100KB max per file to avoid memory issues

  for (const file of textFiles.slice(0, 500)) {
    // Limit to 500 files to avoid memory issues
    try {
      const filePath = resolve(projectPath, file)
      const stats = await import('node:fs/promises').then(m => m.stat(filePath))

      // Skip files that are too large
      if (stats.size > maxFileSize) {
        continue
      }

      const content = await readFile(filePath, 'utf-8')

      // Create a document first, then split it (preserves metadata)
      const doc = new Document({
        pageContent: content,
        metadata: {
          file: file,
          filePath: filePath,
        },
      })

      const chunks = await textSplitter.splitDocuments([doc])
      documents.push(...chunks)
    } catch (error) {
      // Skip files that can't be read (permissions, encoding issues, etc.)
      continue
    }
  }

  // Create vector store from documents
  const vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings)

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

        if (documents.length === 0) {
          return 'No files have been indexed for semantic search. The RAG index may not be initialized.'
        }

        // Perform similarity search
        const results = await vectorStore.similaritySearch(query, limit)

        if (results.length === 0) {
          return `No relevant files found for query: "${query}". Try rephrasing your search or using fuzzy_file_search for filename-based search.`
        }

        // Format results with file paths and content snippets
        const formattedResults = results.map((result, index) => {
          const file = result.metadata.file as string
          const content = result.pageContent
          // Truncate content if too long
          const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content

          return `${index + 1}. ${file}\n   Content snippet:\n   ${snippet
            .split('\n')
            .map(line => `   ${line}`)
            .join('\n')}`
        })

        const resultText = formattedResults.join('\n\n')
        const fileCount = new Set(results.map(r => r.metadata.file)).size

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
        'Semantic search through file CONTENTS using RAG (Retrieval-Augmented Generation). Use this when you need to find files based on what they contain, not just their names. Examples: "where is the authentication code?", "find database connection logic", "search for API endpoints". This is more powerful than fuzzy_file_search which only searches filenames.',
      schema: ragSearchSchema,
    }
  )
}
