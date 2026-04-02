import { Client } from '@langchain/langgraph-sdk'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseMessage } from 'langchain'
import { env } from '@/env'
import { generateAndUpdateThreadTitle } from '@/utils/title-generator'

type AgentState = { messages: Array<BaseMessage> }

export function titleGeneratorNode(state: AgentState, config: RunnableConfig): Partial<AgentState> {
  const threadId = config.configurable?.thread_id

  if (!threadId || config.metadata?.title) {
    return state
  }

  const firstMessage = state.messages.find(message => message.type === 'human')

  if (!firstMessage) {
    return state
  }

  // Run title generation in the background without blocking the graph
  // Using an unawaited promise with error handling is cleaner than setTimeout
  const langGraphClient = new Client({
    apiUrl: env.MODEL_API_BASE_URL,
  })

  generateAndUpdateThreadTitle(
    langGraphClient,
    threadId,
    typeof firstMessage.content === 'string'
      ? firstMessage.content
      : firstMessage.content.map(content => content.text).join('')
  ).catch(error => {
    // Silently handle errors since title generation is non-critical
    console.error('Background title generation failed:', error)
  })

  return state
}
