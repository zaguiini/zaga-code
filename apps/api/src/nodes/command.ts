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

export function createCommandNode() {
  return (state: AgentState): Partial<AgentState> => {
    const lastMessage = [...state.messages].reverse().find(m => m.type === 'human')
    if (!lastMessage) return { commandHandled: false }

    const input = String(lastMessage.content).trim()
    const commandName = input.split(' ')[0]

    if (!(commandName in COMMANDS)) {
      return { commandHandled: false }
    }

    const handler = COMMANDS[commandName]
    return handler(state)
  }
}
