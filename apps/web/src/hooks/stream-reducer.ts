import type { AgentState, StreamEvent } from '@/lib/trpc'

export type StreamState = {
  values: AgentState
  error: string | null
}

export type StreamAction =
  | { type: 'event'; event: StreamEvent }
  | { type: 'reset'; state?: AgentState }
  | { type: 'prepare'; userText?: string }

export const initialStreamState: StreamState = {
  values: {
    configHash: '',
    maxTokens: 0,
    usedTokens: 0,
    messages: [],
    projectPath: '',
  },
  error: null,
}

// FIX: We don't need this, outputs are typed in agent.
function stringifyOutput(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function updateAiMessage(
  messages: AgentState['messages'],
  messageId: string,
  updater: (
    message: Extract<AgentState['messages'][number], { type: 'ai' }>
  ) => Extract<AgentState['messages'][number], { type: 'ai' }>
): AgentState['messages'] {
  const existing = messages.find(message => message.id === messageId)

  if (!existing || existing.type !== 'ai') {
    const created = updater({
      id: messageId,
      type: 'ai',
      content: '',
      reasoning_started_at_ms: Date.now(),
    })
    return [...messages, created]
  }

  return messages.map(message => {
    if (message.id !== messageId || message.type !== 'ai') return message
    return updater(message)
  })
}

function updateToolCallById(
  messages: AgentState['messages'],
  toolCallId: string,
  updater: (
    toolCall: NonNullable<
      Extract<AgentState['messages'][number], { type: 'ai' }>['tool_calls']
    >[number]
  ) => NonNullable<Extract<AgentState['messages'][number], { type: 'ai' }>['tool_calls']>[number]
): AgentState['messages'] {
  return messages.map(message => {
    if (message.type !== 'ai' || !Array.isArray(message.tool_calls)) return message

    const hasMatch = message.tool_calls.some(toolCall => toolCall.id === toolCallId)
    if (!hasMatch) return message

    const nextToolCalls = message.tool_calls.map(toolCall =>
      toolCall.id === toolCallId ? updater(toolCall) : toolCall
    )

    return { ...message, tool_calls: nextToolCalls }
  })
}

function markReasoningComplete(
  message: Extract<AgentState['messages'][number], { type: 'ai' }>
): Extract<AgentState['messages'][number], { type: 'ai' }> {
  if (message.reasoning_ended_at_ms !== undefined) return message

  const startedAt = message.reasoning_started_at_ms ?? Date.now()
  return {
    ...message,
    reasoning_started_at_ms: startedAt,
    reasoning_ended_at_ms: Date.now(),
  }
}

function finalizeOpenReasoning(messages: AgentState['messages']): AgentState['messages'] {
  return messages.map(message => {
    if (message.type !== 'ai') return message
    if (!message.reasoning?.trim()) return message
    return markReasoningComplete(message)
  })
}

function mergeMessagesPreservingClientTransientFields(
  currentMessages: AgentState['messages'],
  incomingMessages: AgentState['messages']
): AgentState['messages'] {
  const currentById = new Map(currentMessages.map(message => [message.id, message] as const))

  return incomingMessages.map(message => {
    if (message.type !== 'ai' || !message.id) return message

    const current = currentById.get(message.id)
    if (!current || current.type !== 'ai') return message

    return {
      ...message,
      ...(current.reasoning_started_at_ms !== undefined
        ? { reasoning_started_at_ms: current.reasoning_started_at_ms }
        : {}),
      ...(current.reasoning_ended_at_ms !== undefined
        ? { reasoning_ended_at_ms: current.reasoning_ended_at_ms }
        : {}),
      ...(Array.isArray(current.tool_calls) && Array.isArray(message.tool_calls)
        ? {
            tool_calls: message.tool_calls.map(toolCall => {
              const currentToolCall = current.tool_calls?.find(c => c.id === toolCall.id)
              if (!currentToolCall) return toolCall

              return {
                ...toolCall,
                ...(currentToolCall.state ? { state: currentToolCall.state } : {}),
                ...(currentToolCall.stream_data !== undefined
                  ? { stream_data: currentToolCall.stream_data }
                  : {}),
                ...(currentToolCall.result !== undefined ? { result: currentToolCall.result } : {}),
                ...(currentToolCall.result_metadata
                  ? { result_metadata: currentToolCall.result_metadata }
                  : {}),
              }
            }),
          }
        : {}),
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
    return { ...state, error: null }
  }

  const { event } = action

  switch (event.type) {
    case 'run.started':
      return state

    case 'assistant.reasoning_delta': {
      const messages = updateAiMessage(state.values.messages, event.messageId, message => ({
        ...message,
        reasoning_started_at_ms: message.reasoning_started_at_ms ?? Date.now(),
        reasoning: `${message.reasoning ?? ''}${event.delta}`,
      }))

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'assistant.text_delta': {
      const messages = updateAiMessage(state.values.messages, event.messageId, message => {
        const withText = {
          ...message,
          content: `${message.content}${event.delta}`,
        }

        return markReasoningComplete(withText)
      })

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'assistant.tool_call': {
      const messages = updateAiMessage(state.values.messages, event.messageId, message => {
        const nextToolCalls = [
          ...(message.tool_calls ?? []),
          { ...event.toolCall, state: 'call' as const },
        ]
        return markReasoningComplete({
          ...message,
          tool_calls: nextToolCalls,
        })
      })

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'tool.started': {
      const messages = updateToolCallById(state.values.messages, event.toolCallId, toolCall => ({
        ...toolCall,
        state: 'call',
      }))

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'tool.delta': {
      const messages = updateToolCallById(state.values.messages, event.toolCallId, toolCall => ({
        ...toolCall,
        state: 'streaming',
        stream_data: event.data,
      }))

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'tool.completed': {
      const messagesWithToolState = updateToolCallById(
        state.values.messages,
        event.toolCallId,
        toolCall => ({
          ...toolCall,
          state: 'result',
          result: stringifyOutput(event.output),
          ...(event.metadata ? { result_metadata: event.metadata } : {}),
        })
      )

      const existingLocalToolMessage = state.values.messages.some(
        message => message.type === 'tool' && message.tool_call_id === event.toolCallId
      )

      const messages = existingLocalToolMessage
        ? messagesWithToolState
        : [
            ...messagesWithToolState,
            {
              id: `local-tool-${event.toolCallId}`,
              type: 'tool' as const,
              name: '',
              tool_call_id: event.toolCallId,
              content: stringifyOutput(event.output),
              ...(event.metadata ? { metadata: event.metadata } : {}),
            },
          ]

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'assistant.completed': {
      const existing = state.values.messages.find(message => message.id === event.message.id)
      const mergedMessages = existing
        ? state.values.messages.map(message =>
            message.id === event.message.id ? { ...message, ...event.message } : message
          )
        : [...state.values.messages, event.message]
      const messages = finalizeOpenReasoning(mergedMessages)

      return {
        ...state,
        values: {
          ...state.values,
          messages,
        },
      }
    }

    case 'run.completed': {
      if (!event.finalState || typeof event.finalState !== 'object') {
        return state
      }

      const incomingMessages = Array.isArray(event.finalState.messages)
        ? event.finalState.messages
        : state.values.messages
      const mergedMessages = mergeMessagesPreservingClientTransientFields(
        state.values.messages,
        incomingMessages
      )
      const nextValues = {
        ...state.values,
        ...event.finalState,
        messages: finalizeOpenReasoning(mergedMessages),
      }

      return {
        ...state,
        values: nextValues,
      }
    }

    case 'run.failed': {
      return {
        ...state,
        values: {
          ...state.values,
          messages: finalizeOpenReasoning(state.values.messages),
        },
        error: event.error.message,
      }
    }

    default:
      return state
  }
}
