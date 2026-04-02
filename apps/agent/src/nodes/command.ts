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

// Per-turn state reset so verify counters don't accumulate across turns
const TURN_RESET: Partial<AgentState> = {
  commandHandled: false,
  critiqueAttempts: 0,
  critiqueFeedback: null,
  verifyVerdict: null,
}

export function createCommandNode() {
  return (state: AgentState): Partial<AgentState> => {
    const lastMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastMessage) return TURN_RESET

    const input = String(lastMessage.content).trim()
    const commandName = input.split(' ')[0]

    if (!(commandName in COMMANDS)) {
      return TURN_RESET
    }

    const handler = COMMANDS[commandName]
    return handler(state)
  }
}
