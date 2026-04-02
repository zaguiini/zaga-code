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

async function setupLmStudioModel() {
  log('Setting up LM Studio model...\n')

  const modelName = env.MODEL

  const localModels = await getLmsModelKeys('ls')

  if (localModels.has(modelName)) {
    log(`✓ ${modelName} already downloaded`)
  } else {
    log(`Downloading ${modelName}...`)
    try {
      await runLms(['get', modelName])
      log(`✓ ${modelName} downloaded\n`)
    } catch {
      console.error(`⚠ Could not download ${modelName} — may already be present, continuing...`)
    }
  }

  const loadedModels = await getLmsModelKeys('ps')

  log('Loading model...')
  if (loadedModels.has(modelName)) {
    log(`✓ ${modelName} already loaded`)
  } else {
    try {
      await runLms(['load', modelName])
      log(`✓ Loaded ${modelName}`)
    } catch {
      console.error(`⚠ Could not load ${modelName} — may already be loaded`)
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
  model: ModelInfo
}

export async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  logLevel = options.logLevel ?? 'silent'
  try {
    await setupLmStudioModel()
    log('✓ Setup complete!')

    const model = await queryModelInfo(env.MODEL)

    return { model }
  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
}
