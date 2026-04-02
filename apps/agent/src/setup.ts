import { spawn } from 'node:child_process'
import { env } from '@/env'

type LogLevel = 'verbose' | 'silent'

let logLevel: LogLevel = 'silent'

function log(message: string) {
  if (logLevel === 'verbose') {
    console.log(message)
  }
}

function runLms(args: Array<string>, { silent = false } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const shouldPipe = silent || logLevel === 'silent'
    const child = spawn('lms', args, {
      stdio: ['inherit', shouldPipe ? 'pipe' : 'inherit', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        stdout += data
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderr += data
      })
    }
    child.on('close', code => {
      if (code === 0) resolve(stdout)
      else
        reject(
          new Error(
            `lms ${args.join(' ')} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`
          )
        )
    })
    child.on('error', reject)
  })
}

async function getLmsModelKeys(command: 'ls' | 'ps'): Promise<Set<string>> {
  try {
    const output = await runLms([command, '--json'], { silent: true })
    const parsed = JSON.parse(output)
    const models = Array.isArray(parsed) ? parsed : []
    return new Set(models.map((m: { modelKey?: string }) => m.modelKey ?? ''))
  } catch {
    return new Set()
  }
}

async function setupLmStudioModels() {
  log('Setting up LM Studio models...\n')

  const models = [
    { name: env.CODING_MODEL, purpose: 'executor + verify (code generation)' },
    { name: env.FAST_MODEL, purpose: 'explore + plan' },
  ]

  const localModels = await getLmsModelKeys('ls')

  for (const { name, purpose } of models) {
    if (localModels.has(name)) {
      log(`✓ ${name} (${purpose}) already downloaded`)
      continue
    }
    log(`Downloading ${name} (${purpose})...`)
    try {
      await runLms(['get', name])
      log(`✓ ${name} downloaded\n`)
    } catch {
      console.error(`⚠ Could not download ${name} — may already be present, continuing...`)
    }
  }

  const loadedModels = await getLmsModelKeys('ps')

  log('Loading models...')
  for (const { name } of models) {
    if (loadedModels.has(name)) {
      log(`✓ ${name} already loaded`)
      continue
    }
    try {
      await runLms(['load', name])
      log(`✓ Loaded ${name}`)
    } catch {
      console.error(`⚠ Could not load ${name} — may already be loaded`)
    }
  }

  log('\nStarting LM Studio server...')
  try {
    await runLms(['server', 'start'])
    log(`✓ LM Studio server started at ${env.MODEL_API_BASE_URL}\n`)
  } catch {
    log('⚠ Server may already be running')
  }
}

export type SetupOptions = {
  logLevel?: LogLevel
}

export type ModelInfo = {
  id: string
  maxTokens: number
}

async function queryModelInfo(modelId: string): Promise<ModelInfo> {
  const output = await runLms(['ps', '--json'], { silent: true })
  const parsed = JSON.parse(output)
  const models = Array.isArray(parsed) ? parsed : []

  const model = models.find(m => m.modelKey === modelId)
  const maxTokens = model?.contextLength ?? 0

  return { id: modelId, maxTokens }
}

export type SetupResult = {
  codingModel: ModelInfo
  fastModel: ModelInfo
}

export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  logLevel = options.logLevel ?? 'silent'
  try {
    await setupLmStudioModels()
    log('✓ Setup complete!')

    const [codingModel, fastModel] = await Promise.all([
      queryModelInfo(env.CODING_MODEL),
      queryModelInfo(env.FAST_MODEL),
    ])

    return { codingModel, fastModel }
  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
}
