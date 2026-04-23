import type { AgentState, StreamEvent } from '@/lib/trpc'

export type ToolProgress = {
  toolCallId: string
  name: string
  state: 'running' | 'completed'
  input: Record<string, unknown>
  result?: Record<string, unknown>
}

export type StreamState = {
  toolProgress: Record<string, ToolProgress | undefined>
  values: AgentState
  error: string | null
}

export type StreamAction =
  | { type: 'event'; event: StreamEvent }
  | { type: 'reset'; state?: AgentState }
  | { type: 'prepare'; userText?: string }

export const initialStreamState: StreamState = {
  toolProgress: {},
  values: {
    configHash: '',
    maxTokens: 0,
    usedTokens: 0,
    messages: [],
    projectPath: '',
  },
  error: null,
}

function appendAssistantText(
  messages: AgentState['messages'],
  messageId: string,
  delta: string
): AgentState['messages'] {
  const existing = messages.find(message => message.id === messageId)
  if (!existing || existing.type !== 'ai') {
    return [
      ...messages,
      {
        id: messageId,
        type: 'ai',
        content: delta,
      },
    ]
  }

  return messages.map(message => {
    if (message.id !== messageId) return message
    if (message.type !== 'ai') return message

    return {
      ...message,
      content: `${message.content}${delta}`,
    }
  })
}

function appendAssistantReasoning(
  messages: AgentState['messages'],
  messageId: string,
  delta: string
): AgentState['messages'] {
  const existing = messages.find(message => message.id === messageId)
  if (!existing || existing.type !== 'ai') {
    return [
      ...messages,
      {
        id: messageId,
        type: 'ai',
        content: '',
        reasoning: delta,
      },
    ]
  }

  return messages.map(message => {
    if (message.id !== messageId) return message
    if (message.type !== 'ai') return message

    return {
      ...message,
      reasoning: `${message.reasoning ?? ''}${delta}`,
    }
  })
}

function appendAssistantToolCall(
  messages: AgentState['messages'],
  messageId: string,
  toolCall: Extract<StreamEvent, { type: 'assistant.tool_call' }>['toolCall']
): AgentState['messages'] {
  const existing = messages.find(message => message.id === messageId)
  if (!existing || existing.type !== 'ai') {
    return [
      ...messages,
      {
        id: messageId,
        type: 'ai',
        content: '',
        tool_calls: [toolCall],
      },
    ]
  }

  return messages.map(message => {
    if (message.id !== messageId) return message
    if (message.type !== 'ai') return message

    return {
      ...message,
      tool_calls: [...(message.tool_calls ?? []), toolCall],
    }
  })
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === 'reset') {
    if (action.state) {
      return {
        ...initialStreamState,
        values: action.state,
      }
    }
    return initialStreamState
  }

  if (action.type === 'prepare') {
    return { ...state, toolProgress: {}, error: null }
  }

  const { event } = action

  switch (event.type) {
    case 'run.started':
      return state

    case 'assistant.reasoning_delta': {
      const messages = appendAssistantReasoning(state.values.messages, event.messageId, event.delta)
      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'assistant.text_delta': {
      const messages = appendAssistantText(state.values.messages, event.messageId, event.delta)
      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'assistant.tool_call': {
      const messages = appendAssistantToolCall(
        state.values.messages,
        event.messageId,
        event.toolCall
      )
      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'tool.started': {
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [event.toolCallId]: {
            toolCallId: event.toolCallId,
            name: event.name,
            input:
              event.input && typeof event.input === 'object'
                ? (event.input as Record<string, unknown>)
                : {},
            state: 'running',
          },
        },
      }
    }

    case 'tool.delta': {
      const existing = state.toolProgress[event.toolCallId]
      if (!existing) return state
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [event.toolCallId]: {
            ...existing,
            input:
              event.data && typeof event.data === 'object'
                ? (event.data as Record<string, unknown>)
                : existing.input,
          },
        },
      }
    }

    case 'tool.completed': {
      const existing = state.toolProgress[event.toolCallId]
      if (!existing) return state

      const result =
        event.output && typeof event.output === 'object'
          ? (event.output as Record<string, unknown>)
          : { output: event.output }

      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [event.toolCallId]: {
            ...existing,
            state: 'completed',
            result,
          },
        },
      }
    }

    case 'assistant.completed': {
      const existing = state.values.messages.find(message => message.id === event.message.id)
      const messages = existing
        ? state.values.messages.map(message =>
            message.id === event.message.id ? { ...message, ...event.message } : message
          )
        : [...state.values.messages, event.message]

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'run.completed': {
      const nextValues =
        event.finalState && typeof event.finalState === 'object'
          ? { ...state.values, ...event.finalState }
          : state.values
      return {
        ...state,
        values: nextValues,
      }
    }

    case 'run.failed': {
      return {
        ...state,
        error: event.error.message,
      }
    }

    default:
      return state
  }
}
