import { LMStudioClient } from '@lmstudio/sdk'
import { KNOWN_OPENAI_CONTEXT_WINDOWS } from './constants'
import { parseSettings } from '@/settings'

export async function fetchContextLength(): Promise<number> {
  const settings = parseSettings()

  if (settings.connection.provider === 'openai') {
    // Static lookup for known models
    const matchingContextWindow = KNOWN_OPENAI_CONTEXT_WINDOWS[settings.connection.model]
    if (matchingContextWindow) return matchingContextWindow

    throw new Error(
      `Unknown OpenAI model: ${settings.connection.model}. Please update KNOWN_OPENAI_CONTEXT_WINDOWS with the context window size for this model.`
    )
  }

  const client = new LMStudioClient()
  const llm = await client.llm.listLoaded()

  const model = llm.find(m => m.modelKey === settings.connection.model)

  if (!model) {
    throw new Error(`Model ${settings.connection.model} not found in LM Studio`)
  }

  return await model.getContextLength()
}
