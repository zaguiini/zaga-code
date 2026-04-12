import type { AgentState, StreamEvent } from '@/lib/trpc'

// ── Tool progress type (replaces @langchain/langgraph-sdk ToolProgress) ──

export type ToolProgress = {
  toolCallId: string
  name: string
  state: 'running' | 'completed'
  input: AgentState['messages'] | Record<string, unknown>
  result?: Record<string, unknown>
}

export type StreamState = {
  toolProgress: Record<string, ToolProgress | undefined>
  _agentToolScopes: Record<string, string>
  values: AgentState
  error: string | null
}

export type StreamAction =
  | { type: 'event'; event: StreamEvent }
  | { type: 'reset'; state?: AgentState }
  | { type: 'prepare'; userText?: string }

export const initialStreamState: StreamState = {
  toolProgress: {},
  _agentToolScopes: {},
  values: {
    configHash: '',
    maxTokens: 0,
    usedTokens: 0,
    messages: [],
    projectPath: '',
  },
  error: null,
}

function isSubagentEvent(event: StreamEvent) {
  return event.metadata.langgraph_checkpoint_ns?.includes('|') ?? false
}

function getParentToolCallId(event: StreamEvent, state: StreamState) {
  const ns = event.metadata.checkpoint_ns
  return ns ? state._agentToolScopes[ns] : undefined
}

function isMessages(
  input: AgentState['messages'] | Record<string, unknown>
): input is AgentState['messages'] {
  return Array.isArray(input)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function appendToAgentMessages(
  state: StreamState,
  parentToolCallId: string,
  message: AgentState['messages'][number]
): StreamState {
  const parent = state.toolProgress[parentToolCallId]
  if (!parent) return state
  const messages = isMessages(parent.input) ? parent.input : []

  const incomingToolCalls = message.type === 'ai' ? message.tool_calls : undefined

  const existing = messages.find(m => m.id === message.id)
  const updatedMessages = existing
    ? messages.map(m => {
        if (m.id !== message.id) return m
        const prev = m.type === 'ai' ? (m.tool_calls ?? []) : []
        const prevIds = new Set(prev.map(tc => tc.id))
        const novel = (incomingToolCalls ?? []).filter(tc => tc.id && !prevIds.has(tc.id))
        return {
          ...m,
          content: `${asString(m.content)}${asString(message.content)}`,
          additional_kwargs: {
            ...m.additional_kwargs,
            reasoning_content: `${asString(m.additional_kwargs?.reasoning_content)}${asString(message.additional_kwargs?.reasoning_content)}`,
          },
          ...(novel.length > 0 ? { tool_calls: [...prev, ...novel] } : {}),
        }
      })
    : [...messages, message]

  return {
    ...state,
    toolProgress: {
      ...state.toolProgress,
      [parentToolCallId]: { ...parent, input: updatedMessages },
    },
  }
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
    const base = { ...state, toolProgress: {}, _agentToolScopes: {}, error: null }
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
  const isSub = isSubagentEvent(event)

  switch (event.event) {
    case 'on_chat_model_stream': {
      const message = event.data.chunk

      if (!message.id) {
        return state
      }

      // Subagent events: accumulate in parent tool's messages instead of main state
      if (isSub) {
        const parentId = getParentToolCallId(event, state)
        if (parentId) return appendToAgentMessages(state, parentId, message)
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
                    content: `${asString(m.content)}${asString(message.content)}`,
                    additional_kwargs: {
                      ...m.additional_kwargs,
                      reasoning_content: `${asString(m.additional_kwargs?.reasoning_content)}${asString(message.additional_kwargs?.reasoning_content)}`,
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
      const toolCallId = event.metadata.tool_call_id ?? event.run_id
      const isAgent = event.name.startsWith('agent-')
      const checkpointNs = event.metadata.checkpoint_ns

      // Subagent inner tool — don't track
      if (isSub) return state

      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [toolCallId]: {
            toolCallId,
            name: event.name,
            input: isAgent ? [] : event.data.input,
            state: 'running',
          },
        },
        ...(isAgent && checkpointNs
          ? {
              _agentToolScopes: {
                ...state._agentToolScopes,
                [checkpointNs]: toolCallId,
              },
            }
          : {}),
      }
    }

    case 'on_tool_end': {
      // Subagent inner tool ended — add tool result to parent's accumulated messages
      if (isSub) {
        const parentId = getParentToolCallId(event, state)
        if (!parentId) return state
        const parent = state.toolProgress[parentId]
        if (!parent) return state
        const messages = isMessages(parent.input) ? parent.input : []

        const output = event.data.output
        const rawKwargs: Record<string, unknown> =
          typeof output['kwargs'] === 'object' && output['kwargs'] !== null
            ? (output['kwargs'] as Record<string, unknown>)
            : output
        const toolMessage: AgentState['messages'][number] = {
          type: 'tool',
          content: typeof rawKwargs['content'] === 'string' ? rawKwargs['content'] : '',
          tool_call_id:
            typeof rawKwargs['tool_call_id'] === 'string' ? rawKwargs['tool_call_id'] : '',
          name: event.name,
          id: typeof rawKwargs['id'] === 'string' ? rawKwargs['id'] : undefined,
        }

        return {
          ...state,
          toolProgress: {
            ...state.toolProgress,
            [parentId]: { ...parent, input: [...messages, toolMessage] },
          },
        }
      }

      const toolCallId = event.metadata.tool_call_id ?? event.run_id
      const existing = state.toolProgress[toolCallId]
      if (!existing) return state
      return {
        ...state,
        toolProgress: {
          ...state.toolProgress,
          [toolCallId]: { ...existing, result: event.data.output, state: 'completed' },
        },
      }
    }

    case 'on_chain_start': {
      if (isSub) return state
      const ns = event.metadata.checkpoint_ns
      if (ns && state._agentToolScopes[ns]) return state
      const input = event.data.input
      if (input !== undefined) {
        return {
          ...state,
          values: {
            ...state.values,
            ...input,
          } as AgentState,
        }
      }
      return state
    }

    case 'on_chain_end': {
      if (isSub) return state
      const ns = event.metadata.checkpoint_ns
      if (ns && state._agentToolScopes[ns]) return state
      const output = event.data.output
      if (output !== undefined) {
        return {
          ...state,
          values: {
            ...state.values,
            ...output,
          } as AgentState,
        }
      }
      return state
    }

    default:
      return state
  }
}
