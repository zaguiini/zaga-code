export type ToolProgress = {
  toolCallId: string
  name: string
  input: unknown
  output: unknown
  status: 'running' | 'done'
}

export type StreamState = {
  streamingContent: string
  toolProgress: Record<string, ToolProgress>
  values: { usedTokens: number; maxTokens: number }
  error: string | null
}

// Raw LangGraph streamEvents v2 shape after JSON serialization
export type RawLangGraphEvent = {
  event: string
  name: string
  run_id: string
  data: Record<string, unknown>
  tags?: Array<string>
  metadata?: Record<string, unknown>
}

export type StreamAction = { type: 'event'; event: RawLangGraphEvent } | { type: 'reset' }

export const initialStreamState: StreamState = {
  streamingContent: '',
  toolProgress: {},
  values: { usedTokens: 0, maxTokens: 0 },
  error: null,
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          typeof c === 'object' && c !== null && (c as { type: string }).type === 'text'
      )
      .map(c => c.text)
      .join('')
  }
  return ''
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === 'reset') return initialStreamState

  const { event } = action

  switch (event.event) {
    case 'on_chat_model_stream': {
      const chunk = event.data.chunk as { content?: unknown } | undefined
      const content = extractTextContent(chunk?.content)
      if (!content) return state
      return { ...state, streamingContent: state.streamingContent + content }
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
            output: undefined,
            status: 'running',
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
          [toolCallId]: { ...existing, output: event.data.output, status: 'done' },
        },
      }
    }

    case 'on_chain_end': {
      const output = event.data.output as Record<string, unknown> | undefined
      if (output !== undefined && output.usedTokens !== undefined) {
        return {
          ...state,
          values: {
            usedTokens: output.usedTokens as number,
            maxTokens: (output.maxTokens as number | undefined) ?? state.values.maxTokens,
          },
        }
      }
      return state
    }

    default:
      return state
  }
}
