import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import React from 'react'
import { render } from 'ink'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { setup } from '@zaga/agent/setup'
import { buildAgentGraph } from '@zaga/agent/graphs/agent'
import { createSession } from '@/session'
import { App } from '@/app'

async function main() {
  const projectPath = process.cwd()

  // Ensure .zaga directory exists for checkpointer DB
  const zagaDir = join(projectPath, '.zaga')
  await mkdir(zagaDir, { recursive: true })

  // Setup LM Studio models
  await setup()

  // Build and compile graph with SQLite checkpointer
  const graph = await buildAgentGraph()
  const checkpointer = SqliteSaver.fromConnString(join(zagaDir, 'history.db'))
  const agent = graph.compile({ checkpointer })

  // Create or load session
  const session = await createSession(projectPath)

  // Parse CLI args as initial prompt
  const prompt = process.argv.slice(2).join(' ') || undefined

  render(<App agent={agent} session={session} projectPath={projectPath} initialPrompt={prompt} />)
}

main().catch(error => {
  console.error('Fatal:', error.message ?? error)
  process.exit(1)
})
