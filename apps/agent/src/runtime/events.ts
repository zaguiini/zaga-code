import type { RuntimeMessage, RuntimeState } from './state'

export type RunScope = {
  runId: string
  parentToolCallId?: string
  depth: number
}

export type ToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

export type UiEvent<TMessage = Record<string, unknown>, TState = Record<string, unknown>> =
  | { type: 'run.started'; scope: RunScope; threadId: string }
  | { type: 'assistant.reasoning_delta'; scope: RunScope; messageId: string; delta: string }
  | { type: 'assistant.text_delta'; scope: RunScope; messageId: string; delta: string }
  | { type: 'assistant.tool_call'; scope: RunScope; messageId: string; toolCall: ToolCall }
  | { type: 'tool.started'; scope: RunScope; toolCallId: string; name: string; input: unknown }
  | { type: 'tool.delta'; scope: RunScope; toolCallId: string; data: unknown }
  | {
      type: 'tool.completed'
      scope: RunScope
      toolCallId: string
      output: unknown
      metadata?: Record<string, unknown>
    }
  | { type: 'assistant.completed'; scope: RunScope; message: TMessage }
  | { type: 'run.completed'; scope: RunScope; finalState: TState }
  | { type: 'run.failed'; scope: RunScope; error: { code: string; message: string } }

export type SerializedStreamEvent = UiEvent<RuntimeMessage, RuntimeState>
