import type { ToolProgress } from '@langchain/langgraph-sdk'
import type { AgentState, StreamEvent } from '@/lib/trpc'

export type { ToolProgress }

export type StreamState = {
  toolProgress: Record<string, ToolProgress>
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
    activeRunId: null,
  },
  error: null,
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
    const text = action.userText?.trim()
    const base = { ...state, toolProgress: {}, error: null }
    if (!text) return base
    const optimisticHuman = {
      id: `local-human-${crypto.randomUUID()}`,
      type: 'human' as const,
      content: [{ type: 'text' as const, text }],
    }
    return {
      ...base,
      values: {
        ...state.values,
        messages: [...state.values.messages, optimisticHuman],
      },
    }
  }

  const { event } = action

  switch (event.event) {
    case 'on_chat_model_stream': {
      const message = event.data.chunk as AgentState['messages'][number]

      if (!message.id) {
        return state
      }

      const existing = state.values.messages.find(m => m.id === message.id)
      if (existing) {
        return {
          ...state,
          values: {
            ...state.values,
            messages: state.values.messages.map(m =>
              m.id === message.id
                ? {
                    ...m,
                    content: `${m.content}${message.content}`,
                    additional_kwargs: {
                      ...m.additional_kwargs,
                      reasoning_content: `${m.additional_kwargs?.reasoning_content ?? ''}${message.additional_kwargs?.reasoning_content ?? ''}`,
                    },
                  }
                : m
            ),
          },
        }
      }

      return {
        ...state,
        values: {
          ...state.values,
          messages: [...state.values.messages, message],
        },
      }
    }

    case 'on_tool_start': {
      const toolCallId = event.run_id
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [toolCallId]: {
            toolCallId,
            name: event.name,
            input: event.data.input,
            state: 'running',
          },
        },
      }
    }

    case 'on_tool_end': {
      const toolCallId = event.run_id
      if (!(toolCallId in state.toolProgress)) return state
      const existing = state.toolProgress[toolCallId]
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [toolCallId]: { ...existing, result: event.data.output, state: 'completed' },
        },
      }
    }

    case 'on_chain_start': {
      const input = event.data.input as Record<string, unknown> | undefined
      if (input !== undefined) {
        return {
          ...state,
          values: {
            ...state.values,
            ...input,
          },
        }
      }
      return state
    }

    case 'on_chain_end': {
      const output = event.data.output as Record<string, unknown> | undefined
      if (output !== undefined) {
        return {
          ...state,
          values: {
            ...state.values,
            ...output,
          },
        }
      }
      return state
    }

    default:
      return state
  }
}
