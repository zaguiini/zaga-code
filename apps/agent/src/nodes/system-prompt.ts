import type { BaseMessage } from 'langchain'
import type { AgentState } from '@/graphs/agent'
import { buildSystemPrompt as buildPrompt } from '@/utils/build-system-prompt'

async function buildSystemPrompt(projectPath: string, configHash: string): Promise<BaseMessage> {
  return await buildPrompt(projectPath, configHash)
}

export async function systemPromptNode(state: AgentState): Promise<Partial<AgentState>> {
  const existingSystem = state.messages.find(msg => msg.type === 'system')

  // Skip rebuild if system message already exists
  if (existingSystem) return {}

  const systemMessage = await buildSystemPrompt(state.projectPath, state.configHash)
  return { messages: [systemMessage] }
}
