export type ToolCall = {
  toolCallId: string
  name: string
  input: string
  output?: string
  status: 'running' | 'done'
}

export type CompletedTurn = {
  userMessage: string
  assistantText: string
  tools: Array<ToolCall>
}

export type AppState = {
  status: 'idle' | 'streaming'
  history: Array<CompletedTurn>
  activeResponse: {
    text: string
    tools: Array<ToolCall>
  } | null
  currentUserMessage: string | null
  tokenCount: number
}

export type AppAction =
  | { type: 'send'; userMessage: string }
  | { type: 'text_chunk'; chunk: string }
  | { type: 'tool_start'; toolCallId: string; name: string; input: string }
  | { type: 'tool_end'; toolCallId: string; output: string }
  | { type: 'stream_end' }
  | { type: 'stream_error'; error: string }
  | { type: 'update_tokens'; count: number }

export const initialState: AppState = {
  status: 'idle',
  history: [],
  activeResponse: null,
  currentUserMessage: null,
  tokenCount: 0,
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        status: 'streaming',
        activeResponse: { text: '', tools: [] },
        currentUserMessage: action.userMessage,
      }

    case 'text_chunk':
      if (!state.activeResponse) return state
      return {
        ...state,
        activeResponse: {
          ...state.activeResponse,
          text: state.activeResponse.text + action.chunk,
        },
      }

    case 'tool_start':
      if (!state.activeResponse) return state
      return {
        ...state,
        activeResponse: {
          ...state.activeResponse,
          tools: [
            ...state.activeResponse.tools,
            {
              toolCallId: action.toolCallId,
              name: action.name,
              input: action.input,
              status: 'running',
            },
          ],
        },
      }

    case 'tool_end': {
      if (!state.activeResponse) return state
      return {
        ...state,
        activeResponse: {
          ...state.activeResponse,
          tools: state.activeResponse.tools.map(t =>
            t.toolCallId === action.toolCallId
              ? { ...t, output: action.output, status: 'done' as const }
              : t
          ),
        },
      }
    }

    case 'stream_end': {
      if (!state.activeResponse) return state
      return {
        ...state,
        status: 'idle',
        history: [
          ...state.history,
          {
            userMessage: state.currentUserMessage ?? '',
            assistantText: state.activeResponse.text,
            tools: state.activeResponse.tools,
          },
        ],
        activeResponse: null,
        currentUserMessage: null,
      }
    }

    case 'stream_error': {
      return {
        ...state,
        status: 'idle',
        history: [
          ...state.history,
          {
            userMessage: state.currentUserMessage ?? '',
            assistantText: `[Error: ${action.error}]`,
            tools: state.activeResponse?.tools ?? [],
          },
        ],
        activeResponse: null,
        currentUserMessage: null,
      }
    }

    case 'update_tokens':
      return { ...state, tokenCount: action.count }
  }
}
