import { join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { render } from 'ink'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { setup } from '@zaga/agent/setup'
import { buildAgentGraph } from '@zaga/agent/graphs/agent'
import { createSession, zagaHistoryDbPath, zagaHomeDir } from '@/session'
import { App } from '@/app'

async function main() {
  const projectPath = process.cwd()

  // Load agent .env before anything accesses env vars
  const agentDir = resolve(import.meta.dirname, '../../agent')
  process.loadEnvFile(join(agentDir, '.env'))

  // Ensure ~/.zaga directory exists for checkpointer DB and events
  await mkdir(zagaHomeDir(), { recursive: true })

  // Setup LM Studio models (verbose only with --verbose flag)
  const verbose = process.argv.includes('--verbose')
  const { codingModel, fastModel } = await setup({ logLevel: verbose ? 'verbose' : 'silent' })

  // Build and compile graph with SQLite checkpointer
  const graph = await buildAgentGraph(codingModel.maxTokens + fastModel.maxTokens)
  const checkpointer = SqliteSaver.fromConnString(zagaHistoryDbPath())
  const agent = graph.compile({ checkpointer })

  // Create in-memory session, optionally resuming from a previous one
  const session = createSession()
  const resumeIdx = process.argv.indexOf('--resume')
  if (resumeIdx !== -1 && process.argv[resumeIdx + 1]) {
    session.setThreadId(process.argv[resumeIdx + 1])
  }

  // Parse CLI args as initial prompt (strip flags and --resume <id>)
  const flagArgs = new Set(['--resume'])
  const args = process.argv.slice(2)
  const positional: Array<string> = []
  for (let i = 0; i < args.length; i++) {
    if (flagArgs.has(args[i])) {
      i++ // skip the flag's value
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i])
    }
  }
  const prompt = positional.join(' ') || undefined

  const { waitUntilExit } = render(
    <App agent={agent} session={session} projectPath={projectPath} initialPrompt={prompt} />
  )

  await waitUntilExit()

  console.log('To restore this session, run: zaga --resume %s', session.threadId)
}

main().catch(error => {
  console.error('Fatal:', error.message ?? error)
  process.exit(1)
})
