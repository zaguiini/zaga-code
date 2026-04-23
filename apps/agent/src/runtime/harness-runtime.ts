import { randomUUID } from 'node:crypto'
import { createOpenAICompatibleClient } from './model/openai-compatible'
import { defaultRuntimeState } from './state'
import { isAsyncGenerator } from './tool-definition'
import { builtInTools, getToolByName, toOpenAIToolDefinitions } from './tools'
import type { AgentRuntime, RunInput, RunOptions, RunResult } from './agent-runtime'
import type { RunScope, SerializedStreamEventV2, ToolCall } from './events'
import type { RuntimeMessage, RuntimeState } from './state'
import { parseSettings } from '@/settings'

function toModelMessages(messages: Array<RuntimeMessage>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.type === 'human') {
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map(part => {
                if (part.type === 'text' && typeof part.text === 'string') {
                  return { type: 'text', text: part.text }
                }

                if (
                  part.type === 'image_url' &&
                  typeof part.image_url === 'object' &&
                  part.image_url !== null &&
                  typeof (part.image_url as { url?: unknown }).url === 'string'
                ) {
                  return {
                    type: 'image_url',
                    image_url: { url: (part.image_url as { url: string }).url },
                  }
                }

                return null
              })
              .filter(Boolean)

      result.push({ role: 'user', content: content.length > 0 ? content : '' })
      continue
    }

    if (message.type === 'ai') {
      const toolCalls = message.tool_calls?.map(toolCall => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.args),
        },
      }))

      result.push({
        role: 'assistant',
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content
                .map(part =>
                  part.type === 'text' && typeof part.text === 'string' ? part.text : ''
                )
                .join(''),
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    if (message.type === 'tool' && message.tool_call_id) {
      result.push({
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content:
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      })
    }
  }

  return result
}

function safeJsonParse(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { value: parsed }
  } catch {
    return { __raw: raw }
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output

  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || error.message.toLowerCase().includes('abort')
}

export class HarnessRuntime implements AgentRuntime<
  SerializedStreamEventV2,
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

  async *stream(input: RunInput, opts: RunOptions = {}): AsyncIterable<SerializedStreamEventV2> {
    const runId = randomUUID()
    const scope: RunScope = { runId, depth: 0 }
    const abortController = new AbortController()

    this.abortByThread.set(input.threadId, abortController)
    const signal = opts.signal ?? abortController.signal
    const { client, model } = createOpenAICompatibleClient(this.getClientConfig())

    const maxSteps = opts.maxSteps ?? 8
    const history = [...input.messages]

    yield { type: 'run.started', scope, threadId: input.threadId }

    try {
      for (let step = 0; step < maxSteps; step++) {
        if (signal.aborted) {
          yield {
            type: 'run.failed',
            scope,
            error: { code: 'RUN_ABORTED', message: 'Run was cancelled before completion.' },
          }
          return
        }

        const messageId = randomUUID()
        const assistantText: Array<string> = []
        const toolCallByIndex = new Map<number, { id: string; name: string; rawArgs: string }>()

        const completion = await client.chat.completions.create({
          model,
          stream: true,
          messages: toModelMessages(history) as any,
          tools: toOpenAIToolDefinitions(builtInTools),
        })

        for await (const chunk of completion) {
          const choice = chunk.choices[0]

          const delta = choice.delta

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            assistantText.push(delta.content)
            yield {
              type: 'assistant.text_delta',
              scope,
              messageId,
              delta: delta.content,
            }
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const callDelta of delta.tool_calls) {
              const index = callDelta.index
              if (typeof index !== 'number') {
                continue
              }
              const current = toolCallByIndex.get(index) ?? { id: '', name: '', rawArgs: '' }

              if (typeof callDelta.id === 'string') {
                current.id = callDelta.id
              }

              if (typeof callDelta.function?.name === 'string') {
                current.name = callDelta.function.name
              }

              if (typeof callDelta.function?.arguments === 'string') {
                current.rawArgs += callDelta.function.arguments
              }

              toolCallByIndex.set(index, current)
            }
          }
        }

        const parsedToolCalls: Array<ToolCall> = Array.from(toolCallByIndex.values())
          .filter(toolCall => toolCall.name)
          .map(toolCall => ({
            id: toolCall.id || randomUUID(),
            name: toolCall.name,
            args: safeJsonParse(toolCall.rawArgs),
          }))

        for (const toolCall of parsedToolCalls) {
          yield {
            type: 'assistant.tool_call',
            scope,
            messageId,
            toolCall,
          }
        }

        const assistantMessage: RuntimeMessage = {
          id: messageId,
          type: 'ai',
          content: assistantText.join(''),
          ...(parsedToolCalls.length > 0 ? { tool_calls: parsedToolCalls } : {}),
        }

        yield {
          type: 'assistant.completed',
          scope,
          message: assistantMessage,
        }

        history.push(assistantMessage)

        if (parsedToolCalls.length === 0) {
          const finalState: RuntimeState = {
            ...defaultRuntimeState,
            projectPath: input.projectPath,
            messages: history,
          }

          yield {
            type: 'run.completed',
            scope,
            finalState,
          }
          return
        }

        for (const toolCall of parsedToolCalls) {
          yield {
            type: 'tool.started',
            scope,
            toolCallId: toolCall.id,
            name: toolCall.name,
            input: toolCall.args,
          }

          const tool = getToolByName(toolCall.name)
          if (!tool) {
            const output = `Tool not found: ${toolCall.name}`
            yield {
              type: 'tool.completed',
              scope,
              toolCallId: toolCall.id,
              output,
            }

            history.push({
              id: randomUUID(),
              type: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: output,
            })
            continue
          }

          const parsedInput = tool.inputSchema.safeParse(toolCall.args)
          if (!parsedInput.success) {
            const output = `Invalid tool input: ${parsedInput.error.message}`
            yield {
              type: 'tool.completed',
              scope,
              toolCallId: toolCall.id,
              output,
            }

            history.push({
              id: randomUUID(),
              type: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: output,
            })
            continue
          }

          try {
            const execution = tool.execute(parsedInput.data, {
              threadId: input.threadId,
              projectPath: input.projectPath,
              toolCallId: toolCall.id,
              runScope: scope,
            })

            let output: unknown
            if (isAsyncGenerator(execution)) {
              for (;;) {
                const next = await execution.next()
                if (next.done) {
                  output = next.value
                  break
                }

                yield {
                  type: 'tool.delta',
                  scope,
                  toolCallId: toolCall.id,
                  data: next.value,
                }
              }
            } else {
              output = await execution
            }

            yield {
              type: 'tool.completed',
              scope,
              toolCallId: toolCall.id,
              output,
            }

            history.push({
              id: randomUUID(),
              type: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: stringifyToolOutput(output),
            })
          } catch (error) {
            const output = error instanceof Error ? error.message : String(error)

            yield {
              type: 'tool.completed',
              scope,
              toolCallId: toolCall.id,
              output,
            }

            history.push({
              id: randomUUID(),
              type: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: output,
            })
          }
        }
      }

      yield {
        type: 'run.failed',
        scope,
        error: {
          code: 'MAX_STEPS_EXCEEDED',
          message: 'Run stopped because it exceeded the configured step limit.',
        },
      }
    } catch (error) {
      if (isAbortError(error)) {
        yield {
          type: 'run.failed',
          scope,
          error: { code: 'RUN_ABORTED', message: 'Run was cancelled before completion.' },
        }
        return
      }

      const message = error instanceof Error ? error.message : `${error}`
      yield {
        type: 'run.failed',
        scope,
        error: { code: 'RUN_FAILED', message },
      }
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
