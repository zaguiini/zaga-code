import { randomUUID } from 'node:crypto'
import type { AgentRuntime, RunInput, RunOptions, RunResult } from './agent-runtime'
import type { RunScope, UiEvent } from './events'

export class HarnessRuntime implements AgentRuntime<UiEvent> {
  private abortByThread = new Map<string, AbortController>()

  async *stream(input: RunInput, opts: RunOptions = {}): AsyncIterable<UiEvent> {
    await Promise.resolve()

    const runId = randomUUID()
    const scope: RunScope = { runId, depth: 0 }
    const abortController = new AbortController()

    this.abortByThread.set(input.threadId, abortController)
    const signal = opts.signal ?? abortController.signal

    yield { type: 'run.started', scope, threadId: input.threadId }

    if (signal.aborted) {
      yield {
        type: 'run.failed',
        scope,
        error: { code: 'RUN_ABORTED', message: 'Run was cancelled before execution.' },
      }
      this.abortByThread.delete(input.threadId)
      return
    }

    const messageId = randomUUID()
    if (input.text.trim()) {
      yield {
        type: 'assistant.text_delta',
        scope,
        messageId,
        delta: input.text.trim(),
      }
    }

    yield {
      type: 'assistant.completed',
      scope,
      message: {
        id: messageId,
        type: 'ai',
        content: input.text.trim() ? input.text.trim() : 'Ready for harness execution.',
      },
    }

    yield {
      type: 'run.completed',
      scope,
      finalState: {
        messages: [
          {
            id: messageId,
            type: 'ai',
            content: input.text.trim() ? input.text.trim() : 'Ready for harness execution.',
          },
        ],
      },
    }

    this.abortByThread.delete(input.threadId)
  }

  async invoke(input: RunInput, opts: RunOptions = {}): Promise<RunResult> {
    const messages: Array<Record<string, unknown>> = []

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
