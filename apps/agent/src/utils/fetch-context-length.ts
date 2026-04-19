import { LMStudioClient } from '@lmstudio/sdk'
import { KNOWN_OPENAI_CONTEXT_WINDOWS } from './constants'
import { parseSettings } from '@/settings'

export async function fetchContextLength(): Promise<number> {
  const settings = parseSettings()

  // Static lookup for known models
  const matchingContextWindow = KNOWN_OPENAI_CONTEXT_WINDOWS[settings.model]
  if (matchingContextWindow) return matchingContextWindow

  const client = new LMStudioClient()
  const llm = await client.llm.listLoaded()

  const model = llm.find(m => m.modelKey === settings.model)

  if (!model) {
    throw new Error(`Model ${settings.model} not found in LM Studio`)
  }

  return await model.getContextLength()
}
