import type { RuntimeMessage, RuntimeState } from './state'

export type RuntimeAction =
  | { type: 'messages.append'; message: RuntimeMessage }
  | { type: 'usedTokens.set'; value: number }
  | { type: 'configHash.set'; value: string }

export function runtimeStateReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case 'messages.append':
      return { ...state, messages: [...state.messages, action.message] }
    case 'usedTokens.set':
      return { ...state, usedTokens: action.value }
    case 'configHash.set':
      return { ...state, configHash: action.value }
    default:
      return state
  }
}
