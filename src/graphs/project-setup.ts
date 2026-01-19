import { resolve } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Document } from '@langchain/core/documents'
import { OllamaEmbeddings } from '@langchain/ollama'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { END, START, StateGraph, StateSchema } from '@langchain/langgraph'
import { z } from 'zod'
import { glob } from 'glob'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { getVecDatabase, initVectorTable } from '@/graphs/db/vec-init'
import { projectEmbeddingsTable } from '@/graphs/db/schema'
import { env } from '@/graphs/env'

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
 * and storing them in SQLite using sqlite-vec
 */
async function indexProject(state: ProjectSetupState): Promise<Partial<ProjectSetupState>> {
  const { projectPath } = state

  try {
    const db = getVecDatabase()
    const drizzleDb = drizzle({ client: db })
    const tableName = initVectorTable(db, projectPath)

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

    // Initialize embeddings using Ollama
    const embeddings = new OllamaEmbeddings({
      model: env.RAG_MODEL,
      baseUrl: env.OLLAMA_API_URL,
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

    // Clear the vector table
    db.exec(`DELETE FROM ${tableName}`)

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

          // Convert embedding array to Float32Array buffer for sqlite-vec
          const embeddingBuffer = new Float32Array(embedding).buffer
          const embeddingBlob = new Uint8Array(embeddingBuffer)

          // Insert into vec0 virtual table first to get the rowid
          const insertVec = db.prepare(`INSERT INTO ${tableName} (embedding) VALUES (?)`)
          const vecResult = insertVec.run(embeddingBlob)
          const vecRowid = Number(vecResult.lastInsertRowid)

          // Insert into project_embeddings table with the vec rowid
          const embeddingId = randomUUID()
          await drizzleDb.insert(projectEmbeddingsTable).values({
            id: embeddingId,
            projectPath,
            file: chunk.metadata.file as string,
            filePath: chunk.metadata.filePath as string,
            content: chunk.pageContent,
            chunkIndex: i,
            vecRowid: vecRowid,
            embedding: Buffer.from(embeddingBuffer),
            createdAt: Date.now(),
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
