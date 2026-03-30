import { resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { Document } from '@langchain/core/documents'
import { OpenAIEmbeddings } from '@langchain/openai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { z } from 'zod'
import { glob } from 'glob'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import { DB_CONNECTION } from '@/db/constants'
import { projectEmbeddingsTable } from '@/db/schema'
import { env } from '@/env'

/**
 * State schema for the project-setup graph
 */
const projectSetupState = z.object({
  projectPath: z.string().describe('The root path of the project to index'),
  status: z
    .enum(['indexing', 'completed', 'error'])
    .default('indexing')
    .describe('Current status of the indexing process'),
  message: z.string().optional().describe('Status message or error description'),
  filesIndexed: z.number().default(0).describe('Number of files indexed'),
  chunksIndexed: z.number().default(0).describe('Number of chunks indexed'),
})

type ProjectSetupState = z.infer<typeof projectSetupState>

/**
 * Indexes a project by reading files, chunking them, generating embeddings,
 * and storing them in PostgreSQL using pgvector
 */
async function indexProject({
  projectPath,
}: ProjectSetupState): Promise<Partial<ProjectSetupState>> {
  try {
    const drizzleDb = drizzle(DB_CONNECTION)

    // Filter to only include text-based files
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

    // Get all project files
    const projectFiles = await glob('**/*', {
      cwd: projectPath,
      absolute: false,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**'],
    })

    const textFiles = projectFiles.filter(file => {
      const ext = file.substring(file.lastIndexOf('.'))
      return textExtensions.includes(ext.toLowerCase())
    })

    const embeddings = new OpenAIEmbeddings({
      model: env.RAG_MODEL,
      apiKey: 'lm-studio',
      configuration: { baseURL: env.LM_STUDIO_API_URL },
    })

    // Initialize text splitter
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', ' ', ''],
    })

    // Load and chunk documents
    const maxFileSize = 100 * 1024 // 100KB max per file
    let filesIndexed = 0
    let chunksIndexed = 0

    // Clear existing embeddings for this project
    await drizzleDb
      .delete(projectEmbeddingsTable)
      .where(eq(projectEmbeddingsTable.projectPath, projectPath))

    for (const file of textFiles.slice(0, 500)) {
      // Limit to 500 files
      try {
        const filePath = resolve(projectPath, file)
        const stats = await stat(filePath)

        if (stats.size > maxFileSize) {
          console.log('File is too large', filePath)
          continue
        }

        const content = await readFile(filePath, 'utf-8')

        const doc = new Document({
          pageContent: content,
          metadata: {
            file: file,
            filePath: filePath,
          },
        })

        const chunks = await textSplitter.splitDocuments([doc])

        // Generate embeddings for all chunks
        const texts = chunks.map(chunk => chunk.pageContent)
        const embeddingVectors = await embeddings.embedDocuments(texts)

        // Insert chunks and embeddings into database
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const embedding = embeddingVectors[i]

          // Insert into project_embeddings table with vector embedding
          // The vector type from drizzle-orm handles conversion
          await drizzleDb.insert(projectEmbeddingsTable).values({
            projectPath,
            file: chunk.metadata.file as string,
            filePath: chunk.metadata.filePath as string,
            content: chunk.pageContent,
            chunkIndex: i,
            embedding: embedding, // Array of numbers, vector type handles conversion
            createdAt: new Date(), // Use Date object, not Date.now() number
          })

          chunksIndexed++
        }

        filesIndexed++
      } catch (error) {
        console.log('Error', error)
        // Skip files that can't be read
        continue
      }
    }

    return {
      status: 'completed',
      message: `Successfully indexed ${filesIndexed} files with ${chunksIndexed} chunks`,
      filesIndexed,
      chunksIndexed,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Creates the project-setup graph
 */
export function createProjectSetupGraph() {
  const stateSchema = new StateSchema({
    projectPath: z
      .string()
      .describe('The root path of the project to index')
      .min(1)
      .startsWith('/'),
    status: z
      .enum(['indexing', 'completed', 'error'])
      .default('indexing')
      .describe('Current status of the indexing process'),
    message: z.string().optional().describe('Status message or error description'),
    filesIndexed: z.number().default(0).describe('Number of files indexed'),
    chunksIndexed: z.number().default(0).describe('Number of chunks indexed'),
  })
  const workflow = new StateGraph(stateSchema)

  workflow.addNode('index', indexProject).addEdge(START, 'index').addEdge('index', END)

  return workflow.compile()
}
