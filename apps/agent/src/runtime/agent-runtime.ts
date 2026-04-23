import type { UiEvent } from './events'

export type RunInput = {
  threadId: string
  projectPath: string
  text: string
  images: Array<{ name: string; mimeType: string; url: string }>
}

export type RunOptions = {
  signal?: AbortSignal
  maxSteps?: number
}

export type RunResult<TMessage = Record<string, unknown>> = {
  messages: Array<TMessage>
}

export interface AgentRuntime<TEvent = UiEvent, TResult = RunResult> {
  stream: (input: RunInput, opts?: RunOptions) => AsyncIterable<TEvent>
  invoke: (input: RunInput, opts?: RunOptions) => Promise<TResult>
  cancel: (threadId: string) => void
}
