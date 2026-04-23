import OpenAI from 'openai'

export type OpenAICompatibleConfig = {
  apiKey: string
  model: string
  baseURL?: string
}

export function createOpenAICompatibleClient(config: OpenAICompatibleConfig) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  })

  return {
    client,
    model: config.model,
  }
}
