import { Ollama } from 'ollama'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { initVectorTable } from './db/vec-init'
import { env } from '@/env'

/**
 * Checks if a model is already downloaded in Ollama
 */
async function isModelAvailable(ollama: Ollama, model: string): Promise<boolean> {
  try {
    const response = await ollama.list()
    return response.models.some(m => m.name === model || m.name.startsWith(`${model}:`))
  } catch (error) {
    console.error(`Error checking for model ${model}:`, error)
    return false
  }
}

/**
 * Downloads an Ollama model with progress feedback
 */
async function downloadModel(ollama: Ollama, model: string): Promise<void> {
  console.log(`Downloading model: ${model}...`)
  console.log('This may take a while depending on your internet connection and model size.')

  try {
    const stream = await ollama.pull({ model, stream: true })

    for await (const chunk of stream) {
      if (chunk.status === 'pulling manifest') {
        console.log(`  Pulling manifest for ${model}...`)
      } else if (chunk.status === 'downloading') {
        const progress =
          chunk.completed && chunk.total
            ? `  ${((chunk.completed / chunk.total) * 100).toFixed(1)}%`
            : '  Downloading...'
        process.stdout.write(`\r${progress}`)
      } else if (chunk.status === 'success') {
        console.log(`\n  ✓ Successfully downloaded ${model}`)
      }
    }
  } catch (error) {
    console.error(`\n  ✗ Failed to download ${model}:`, error)
    throw error
  }
}

/**
 * Sets up Ollama models required for the application
 */
async function setupOllamaModels() {
  const ollama = new Ollama({
    host: env.OLLAMA_API_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  })

  const models = [
    { name: env.AGENT_MODEL, purpose: 'agent and title generation' },
    { name: env.RAG_MODEL, purpose: 'embeddings for RAG' },
    { name: env.SUMMARIZATION_MODEL, purpose: 'summarization for title generation' },
  ]

  console.log('Checking Ollama models...\n')

  for (const { name, purpose } of models) {
    const isAvailable = await isModelAvailable(ollama, name)

    if (isAvailable) {
      console.log(`✓ Model "${name}" (${purpose}) is already available`)
    } else {
      console.log(`✗ Model "${name}" (${purpose}) is not available`)
      await downloadModel(ollama, name)
    }
  }

  console.log('\n✓ All required Ollama models are ready!')
}

/**
 * Sets up the Postgres checkpointer tables
 */
async function setupPostgresCheckpointer() {
  console.log('Setting up Postgres checkpointer...')
  try {
    const checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL)
    await checkpointer.setup()
    console.log('✓ Postgres checkpointer tables created')
  } catch (error) {
    console.error('✗ Failed to setup Postgres checkpointer:', error)
    throw error
  }
}

async function setupVectorTable() {
  console.log('Setting up vector table...')
  try {
    await initVectorTable()
    console.log('✓ Vector table created')
  } catch (error) {
    console.error('✗ Failed to setup vector table:', error)
    throw error
  }
}

/**
 * Main setup function
 */
const setup = async () => {
  try {
    await setupPostgresCheckpointer()
    await setupVectorTable()
    await setupOllamaModels()
  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
}

setup()
