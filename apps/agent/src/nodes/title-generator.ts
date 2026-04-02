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

  if (!env.LANGGRAPH_API_URL) {
    return state
  }

  const langGraphClient = new Client({
    apiUrl: env.LANGGRAPH_API_URL,
  })

  generateAndUpdateThreadTitle(
    langGraphClient,
    threadId,
    typeof firstMessage.content === 'string'
      ? firstMessage.content
      : firstMessage.content.map(content => content.text).join('')
  ).catch(error => {
    console.error('Background title generation failed:', error)
  })

  return state
}
