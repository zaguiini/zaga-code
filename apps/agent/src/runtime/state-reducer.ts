import type { AgentState } from '@/graphs/agent'

export type RuntimeAction =
  | { type: 'messages.append'; message: AgentState['messages'][number] }
  | { type: 'usedTokens.set'; value: number }
  | { type: 'configHash.set'; value: string }
  | { type: 'memoryCommandHandled.set'; value: boolean }

export function runtimeStateReducer(state: AgentState, action: RuntimeAction): AgentState {
  switch (action.type) {
    case 'messages.append':
      return { ...state, messages: [...state.messages, action.message] }
    case 'usedTokens.set':
      return { ...state, usedTokens: action.value }
    case 'configHash.set':
      return { ...state, configHash: action.value }
    case 'memoryCommandHandled.set':
      return { ...state, memoryCommandHandled: action.value }
    default:
      return state
  }
}
