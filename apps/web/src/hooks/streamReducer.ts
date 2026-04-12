import type { ToolProgress } from '@langchain/langgraph-sdk'
import type { AgentState, StreamEvent } from '@/lib/trpc'

export type { ToolProgress }

export type StreamState = {
  toolProgress: Record<string, ToolProgress>
  /** Maps checkpoint_ns of an agent tool → its tool_call_id in toolProgress */
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
    activeRunId: null,
  },
  error: null,
}

type EventMeta = Record<string, unknown>

function getMeta(event: StreamEvent): EventMeta {
  return event.metadata
}

function isSubagentEvent(event: StreamEvent): boolean {
  const ns = getMeta(event).langgraph_checkpoint_ns as string | undefined
  return ns?.includes('|') ?? false
}

function getParentToolCallId(event: StreamEvent, state: StreamState): string | undefined {
  const ns = getMeta(event).checkpoint_ns as string | undefined
  return ns ? state._agentToolScopes[ns] : undefined
}

function appendToAgentMessages(
  state: StreamState,
  parentToolCallId: string,
  message: AgentState['messages'][number]
): StreamState {
  const parent = state.toolProgress[parentToolCallId] as ToolProgress | undefined
  if (!parent) return state
  const messages = Array.isArray(parent.input)
    ? (parent.input as AgentState['messages'])
    : ([] as AgentState['messages'])

  type ToolCall = { name: string; args: unknown; id?: string; type?: string }
  const incomingToolCalls = (message as unknown as { tool_calls?: Array<ToolCall> }).tool_calls

  const existing = messages.find(m => m.id === message.id)
  const updatedMessages = existing
    ? messages.map(m => {
        if (m.id !== message.id) return m
        const prev = (m as unknown as { tool_calls?: Array<ToolCall> }).tool_calls ?? []
        const prevIds = new Set(prev.map(tc => tc.id))
        const novel = (incomingToolCalls ?? []).filter(tc => tc.id && !prevIds.has(tc.id))
        return {
          ...m,
          content: `${m.content}${message.content}`,
          additional_kwargs: {
            ...m.additional_kwargs,
            reasoning_content: `${m.additional_kwargs?.reasoning_content ?? ''}${message.additional_kwargs?.reasoning_content ?? ''}`,
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

  console.log(event.event, event.name)

  const meta = getMeta(event)
  const isSub = isSubagentEvent(event)

  switch (event.event) {
    case 'on_chat_model_stream': {
      const message = event.data.chunk as AgentState['messages'][number]

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
      const toolCallId = (meta.tool_call_id as string | undefined) ?? event.run_id
      const isAgent = event.name.startsWith('agent-')
      const checkpointNs = meta.checkpoint_ns as string | undefined

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
        const parent = state.toolProgress[parentId] as ToolProgress | undefined
        if (!parent) return state
        const messages = Array.isArray(parent.input)
          ? (parent.input as AgentState['messages'])
          : ([] as AgentState['messages'])

        const output = event.data.output as { kwargs?: Record<string, unknown> } | undefined
        const kwargs = output?.kwargs ?? (output as Record<string, unknown> | undefined)
        const toolMessage = {
          type: 'tool' as const,
          content: (kwargs?.content as string | undefined) ?? '',
          tool_call_id: (kwargs?.tool_call_id as string | undefined) ?? '',
          name: event.name,
          id: kwargs?.id as string | undefined,
        }

        return {
          ...state,
          toolProgress: {
            ...state.toolProgress,
            [parentId]: { ...parent, input: [...messages, toolMessage] },
          },
        }
      }

      const toolCallId = (meta.tool_call_id as string | undefined) ?? event.run_id
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
      if (isSub) return state
      const ns = meta.checkpoint_ns as string | undefined
      if (ns && state._agentToolScopes[ns]) return state
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
      if (isSub) return state
      const ns = meta.checkpoint_ns as string | undefined
      if (ns && state._agentToolScopes[ns]) return state
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
