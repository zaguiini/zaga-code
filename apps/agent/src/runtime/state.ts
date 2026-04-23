export type RuntimeMessage = {
  id?: string
  type: 'human' | 'ai' | 'tool' | string
  content: string | Array<Record<string, unknown>>
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
    type?: 'tool_call'
  }>
  metadata?: Record<string, unknown>
  additional_kwargs?: Record<string, unknown>
}

export type RuntimeState = {
  configHash: string
  maxTokens: number
  usedTokens: number
  messages: Array<RuntimeMessage>
  projectPath: string
  memoryCommandHandled: boolean
}

export const defaultRuntimeState: RuntimeState = {
  configHash: '',
  maxTokens: 0,
  usedTokens: 0,
  messages: [],
  projectPath: '',
  memoryCommandHandled: false,
}
