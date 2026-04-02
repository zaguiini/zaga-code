import { AIMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'

const COMMANDS: Record<string, (state: AgentState) => Partial<AgentState>> = {
  '/compact': () => ({
    commandHandled: true,
    forceCompact: true,
    messages: [new AIMessage({ content: '[compacting conversation...]' })],
  }),
  '/help': () => ({
    commandHandled: true,
    messages: [
      new AIMessage({
        content:
          'Available commands:\n  /compact   Summarize conversation and free up context\n  /help      Show this message\n  /exit      Exit the agent',
      }),
    ],
  }),
}

export function createCommandNode(maxTokens: number) {
  // Per-turn state reset so verify counters don't accumulate across turns
  const turnReset: Partial<AgentState> = {
    commandHandled: false,
    critiqueAttempts: 0,
    critiqueFeedback: null,
    verifyVerdict: null,
    maxTokens,
  }

  return (state: AgentState): Partial<AgentState> => {
    const lastMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastMessage) return turnReset

    const input = String(lastMessage.content).trim()
    const commandName = input.split(' ')[0]

    if (!(commandName in COMMANDS)) {
      return turnReset
    }

    const handler = COMMANDS[commandName]
    return handler(state)
  }
}
