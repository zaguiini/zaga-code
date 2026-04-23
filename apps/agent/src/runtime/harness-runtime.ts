import { createOpenAICompatibleClient } from './model/openai-compatible'
import { HarnessRunLoop } from './harness-run-loop'
import type { AgentRuntime, RunInput, RunOptions, RunResult } from './agent-runtime'
import type { SerializedStreamEvent } from './events'
import type { RuntimeMessage } from './state'
import { parseSettings } from '@/settings'

export class HarnessRuntime implements AgentRuntime<
  SerializedStreamEvent,
  RunResult<RuntimeMessage>
> {
  private abortByThread = new Map<string, AbortController>()

  private getClientConfig() {
    const settings = parseSettings()

    if (settings.connection.provider === 'openai') {
      return {
        apiKey: settings.connection.apiKey,
        model: settings.connection.model,
      }
    }

    return {
      apiKey: 'lm-studio',
      model: settings.connection.model,
      baseURL: settings.connection.apiBase,
    }
  }

  async *stream(input: RunInput, opts: RunOptions = {}): AsyncIterable<SerializedStreamEvent> {
    const abortController = new AbortController()
    this.abortByThread.set(input.threadId, abortController)

    const signal = opts.signal ?? abortController.signal
    const { client, model } = createOpenAICompatibleClient(this.getClientConfig())
    const loop = new HarnessRunLoop(input, signal, client, model, opts.maxSteps)

    try {
      yield* loop.run()
    } finally {
      this.abortByThread.delete(input.threadId)
    }
  }

  async invoke(input: RunInput, opts: RunOptions = {}): Promise<RunResult<RuntimeMessage>> {
    const messages: Array<RuntimeMessage> = []

    for await (const event of this.stream(input, opts)) {
      if (event.type === 'assistant.completed') {
        messages.push(event.message)
      }
    }

    return { messages }
  }

  cancel(threadId: string): void {
    this.abortByThread.get(threadId)?.abort()
  }
}
