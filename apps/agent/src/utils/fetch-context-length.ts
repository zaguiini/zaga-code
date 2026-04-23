import { LMStudioClient } from '@lmstudio/sdk'
import { KNOWN_OPENAI_CONTEXT_WINDOWS } from './constants'
import { parseSettings } from '@/settings'

const DEFAULT_CONTEXT_WINDOW = 128_000

export async function fetchContextLength(): Promise<number> {
  const settings = parseSettings()

  if (settings.connection.provider === 'openai') {
    // Static lookup for known models
    const matchingContextWindow = KNOWN_OPENAI_CONTEXT_WINDOWS[settings.connection.model]
    if (matchingContextWindow) return matchingContextWindow

    return DEFAULT_CONTEXT_WINDOW
  }

  try {
    const client = new LMStudioClient()
    const llm = await client.llm.listLoaded()

    const model = llm.find(m => m.modelKey === settings.connection.model)

    if (!model) return DEFAULT_CONTEXT_WINDOW

    return await model.getContextLength()
  } catch {
    return DEFAULT_CONTEXT_WINDOW
  }
}
