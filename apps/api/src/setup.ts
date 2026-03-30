import { spawn } from 'node:child_process'
import { env } from '@/env'

function runLms(args: Array<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('lms', args, { stdio: 'inherit' })
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`lms ${args.join(' ')} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

async function setupLmStudioModels() {
  console.log('Setting up LM Studio models...\n')

  const models = [
    { name: env.REASONING_MODEL, purpose: 'router, planner, critic' },
    { name: env.CODING_MODEL, purpose: 'executor (code generation)' },
    { name: env.SUMMARIZATION_MODEL, purpose: 'thread title generation' },
  ]

  for (const { name, purpose } of models) {
    console.log(`Downloading ${name} (${purpose})...`)
    try {
      await runLms(['get', name])
      console.log(`✓ ${name} downloaded\n`)
    } catch {
      console.log(`⚠ Could not download ${name} — may already be present, continuing...\n`)
    }
  }

  console.log('Loading models...')
  for (const { name } of models) {
    try {
      await runLms(['load', name])
      console.log(`✓ Loaded ${name}`)
    } catch {
      console.log(`⚠ Could not load ${name} — may already be loaded`)
    }
  }

  console.log('\nStarting LM Studio server...')
  try {
    await runLms(['server', 'start'])
    console.log(`✓ LM Studio server started at ${env.LM_STUDIO_API_URL}\n`)
  } catch {
    console.log('⚠ Server may already be running\n')
  }
}

const setup = async () => {
  try {
    await setupLmStudioModels()
    console.log('✓ Setup complete!')
  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
}

setup()
