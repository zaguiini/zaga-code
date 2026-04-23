export type RuntimeTextPart = {
  type: 'text'
  text: string
}

export type RuntimeImagePart = {
  type: 'image_url'
  image_url: { url: string }
  name?: string
}

export type RuntimeHumanMessage = {
  id?: string
  type: 'human'
  content: string | Array<RuntimeTextPart | RuntimeImagePart>
}

export type RuntimeToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
  type?: 'tool_call'
}

export type RuntimeAiMessage = {
  id?: string
  type: 'ai'
  content: string
  reasoning?: string
  tool_calls?: Array<RuntimeToolCall>
  metadata?: Record<string, unknown>
}

export type RuntimeToolMessage = {
  id?: string
  type: 'tool'
  name: string
  tool_call_id: string
  content: string
}

export type RuntimeMessage = RuntimeHumanMessage | RuntimeAiMessage | RuntimeToolMessage

export function isRuntimeHumanMessage(message: RuntimeMessage): message is RuntimeHumanMessage {
  return message.type === 'human'
}

export function isRuntimeAiMessage(message: RuntimeMessage): message is RuntimeAiMessage {
  return message.type === 'ai'
}

export function isRuntimeToolMessage(message: RuntimeMessage): message is RuntimeToolMessage {
  return message.type === 'tool'
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
