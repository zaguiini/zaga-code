import { ChatOpenAI } from '@langchain/openai'
import { parseSettings } from '@/settings'

type GetModelOptions = {
  streaming?: boolean
}

export const getModel = (options: GetModelOptions = {}) => {
  const { connection } = parseSettings()
  const streaming = options.streaming ?? true

  if (connection.provider === 'openai') {
    return new ChatOpenAI({
      model: connection.model,
      apiKey: connection.apiKey,
      streaming,
      streamUsage: streaming,
    })
  }

  return new ChatOpenAI({
    model: connection.model,
    configuration: { baseURL: connection.apiBase },
    apiKey: 'local',
    streaming,
    streamUsage: streaming,
  })
}
