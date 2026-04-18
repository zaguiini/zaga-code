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

type RawToolCall = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/**
 * Merge streamed `additional_kwargs.tool_calls` arrays by index,
 * concatenating `function.arguments` strings. Then try to parse
 * each accumulated arguments string to rebuild proper `tool_calls`.
 */
function mergeAdditionalKwargs(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined
): {
  additional_kwargs: Record<string, unknown>
  tool_calls:
    | Array<{ name: string; args: Record<string, unknown>; id: string; type: 'tool_call' }>
    | undefined
} {
  const merged: Record<string, unknown> = {
    ...prev,
    reasoning_content: `${asString(prev?.reasoning_content)}${asString(next?.reasoning_content)}`,
  }

  const prevRaw = (prev?.tool_calls ?? []) as Array<RawToolCall>
  const nextRaw = (next?.tool_calls ?? []) as Array<RawToolCall>

  if (prevRaw.length === 0 && nextRaw.length === 0) {
    return { additional_kwargs: merged, tool_calls: undefined }
  }

  const rawMerged = [...prevRaw]
  for (const inc of nextRaw) {
    const idx = inc.index ?? 0
    const ex = rawMerged[idx] as RawToolCall | undefined
    if (ex) {
      rawMerged[idx] = {
        ...ex,
        ...(inc.id ? { id: inc.id } : {}),
        function: {
          name: inc.function?.name || ex.function?.name,
          arguments: (ex.function?.arguments ?? '') + (inc.function?.arguments ?? ''),
        },
      }
    } else {
      rawMerged[idx] = inc
    }
  }

  merged.tool_calls = rawMerged

  type ParsedToolCall = {
    name: string
    args: Record<string, unknown>
    id: string
    type: 'tool_call'
  }

  const parsed: Array<ParsedToolCall> = rawMerged
    .map((tc): ParsedToolCall | null => {
      if (!tc.function?.arguments) return null
      try {
        return {
          name: tc.function.name ?? '',
          args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          id: tc.id ?? '',
          type: 'tool_call',
        }
      } catch {
        return null
      }
    })
    .filter((tc): tc is ParsedToolCall => tc !== null)

  return {
    additional_kwargs: merged,
    tool_calls: parsed.length > 0 ? parsed : undefined,
  }
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
        const { additional_kwargs, tool_calls: rebuilt } = mergeAdditionalKwargs(
          m.additional_kwargs,
          message.additional_kwargs
        )
        return {
          ...m,
          content: `${asString(m.content)}${asString(message.content)}`,
          additional_kwargs,
          ...(rebuilt
            ? { tool_calls: rebuilt }
            : novel.length > 0
              ? { tool_calls: [...prev, ...novel] }
              : {}),
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
            messages: state.values.messages.map(m => {
              if (m.id !== message.id) return m
              const { additional_kwargs, tool_calls: rebuilt } = mergeAdditionalKwargs(
                m.additional_kwargs,
                message.additional_kwargs
              )
              return {
                ...m,
                content: `${asString(m.content)}${asString(message.content)}`,
                additional_kwargs,
                ...(rebuilt ? { tool_calls: rebuilt } : {}),
              }
            }),
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
