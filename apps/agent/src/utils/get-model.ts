import { ChatOpenAI } from '@langchain/openai'
import { parseSettings } from '@/settings'

export const getModel = () => {
  const { connection } = parseSettings()

  if (connection.provider === 'openai') {
    return new ChatOpenAI({
      model: connection.model,
      apiKey: connection.apiKey,
      streaming: true,
      streamUsage: true,
    })
  }

  return new ChatOpenAI({
    model: connection.model,
    configuration: { baseURL: connection.apiBase },
    apiKey: 'local',
    streaming: true,
    streamUsage: true,
  })
}
