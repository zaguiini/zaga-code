import { ChatOpenAI } from '@langchain/openai'
import { parseSettings } from '@/settings'

export const getModel = () => {
  const settings = parseSettings()

  return new ChatOpenAI({
    model: settings.model,
    configuration: settings.apiKey ? undefined : { baseURL: settings.apiBase },
    apiKey: settings.apiKey,
    streaming: true,
    streamUsage: true,
  })
}
