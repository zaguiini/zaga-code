import { randomUUID } from 'node:crypto'
import { defaultRuntimeState } from './state'
import { isAsyncGenerator } from './tool-definition'
import { normalizeRuntimeToolOutput } from './tool-output'
import { builtInTools, getToolByName, toOpenAIToolDefinitions } from './tools'
import type { RunInput } from './agent-runtime'
import type { RunScope, SerializedStreamEvent, ToolCall } from './events'
import type { RuntimeMessage, RuntimeState } from './state'
import type { RuntimeToolOutput } from './tool-output'
import type OpenAI from 'openai'

type PartialToolCall = {
  id: string
  name: string
  rawArgs: string
}

type AssistantTurnResult = {
  message: RuntimeMessage
  toolCalls: Array<ToolCall>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toModelMessages(
  messages: Array<RuntimeMessage>
): Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  const result: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> = []

  for (const message of messages) {
    if (message.type === 'human') {
      if (typeof message.content === 'string') {
        result.push({
          role: 'user',
          content: message.content,
        })
        continue
      }

      const parts: Array<OpenAI.Chat.Completions.ChatCompletionContentPart> = []
      for (const part of message.content) {
        if (part.type === 'text') {
          parts.push({ type: 'text', text: part.text })
          continue
        }

        parts.push({
          type: 'image_url',
          image_url: { url: part.image_url.url },
        })
      }

      result.push({ role: 'user', content: parts })
      continue
    }

    if (message.type === 'ai') {
      const toolCalls = message.tool_calls?.map(toolCall => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.args),
        },
      }))

      result.push({
        role: 'assistant',
        content: message.content,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    result.push({
      role: 'tool',
      tool_call_id: message.tool_call_id,
      content: message.content,
    })
  }

  return result
}

function safeJsonParse(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}

  try {
    const parsed = JSON.parse(raw)
    if (isRecord(parsed)) {
      return parsed
    }
    return { value: parsed }
  } catch {
    return { __raw: raw }
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || error.message.toLowerCase().includes('abort')
}

function extractReasoningDelta(delta: unknown): string | undefined {
  if (!isRecord(delta)) return undefined
  const record = delta

  const candidates = [record.reasoning, record.reasoning_content, record.reasoningContent]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }

  return undefined
}

export class HarnessRunLoop {
  private readonly runId = randomUUID()
  private readonly scope: RunScope = { runId: this.runId, depth: 0 }
  private readonly history: Array<RuntimeMessage>
  private readonly maxSteps: number

  constructor(
    private readonly input: RunInput,
    private readonly signal: AbortSignal,
    private readonly client: OpenAI,
    private readonly model: string,
    maxSteps?: number
  ) {
    this.history = [...input.messages]
    this.maxSteps = maxSteps ?? 8
  }

  async *run(): AsyncIterable<SerializedStreamEvent> {
    yield { type: 'run.started', scope: this.scope, threadId: this.input.threadId }
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (this.signal.aborted) {
          yield {
            type: 'run.failed',
            scope: this.scope,
            error: { code: 'RUN_ABORTED', message: 'Run was cancelled before completion.' },
          }
          return
        }

        const turn = yield* this.runAssistantTurn()
        this.history.push(turn.message)

        if (turn.toolCalls.length === 0) {
          const finalState: RuntimeState = {
            ...defaultRuntimeState,
            projectPath: this.input.projectPath,
            messages: this.history,
          }

          yield {
            type: 'run.completed',
            scope: this.scope,
            finalState,
          }
          return
        }

        yield* this.executeToolCalls(turn.toolCalls)
      }

      yield {
        type: 'run.failed',
        scope: this.scope,
        error: {
          code: 'MAX_STEPS_EXCEEDED',
          message: 'Run stopped because it exceeded the configured step limit.',
        },
      }
    } catch (error) {
      if (isAbortError(error)) {
        yield {
          type: 'run.failed',
          scope: this.scope,
          error: { code: 'RUN_ABORTED', message: 'Run was cancelled before completion.' },
        }
        return
      }

      const message = error instanceof Error ? error.message : `${error}`
      yield {
        type: 'run.failed',
        scope: this.scope,
        error: { code: 'RUN_FAILED', message },
      }
    }
  }

  private async *runAssistantTurn(): AsyncGenerator<
    SerializedStreamEvent,
    AssistantTurnResult,
    void
  > {
    const messageId = randomUUID()
    const assistantText: Array<string> = []
    const assistantReasoning: Array<string> = []
    let reasoningStartedAtMs: number | undefined
    const toolCallByIndex = new Map<number, PartialToolCall>()

    const completion = await this.client.chat.completions.create({
      model: this.model,
      stream: true,
      messages: toModelMessages(this.history),
      tools: toOpenAIToolDefinitions(builtInTools),
    })

    for await (const chunk of completion) {
      const choice = chunk.choices[0]
      const delta = choice.delta

      const reasoningDelta = extractReasoningDelta(delta)
      if (reasoningDelta) {
        reasoningStartedAtMs ??= Date.now()
        assistantReasoning.push(reasoningDelta)
        yield {
          type: 'assistant.reasoning_delta',
          scope: this.scope,
          messageId,
          delta: reasoningDelta,
        }
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        assistantText.push(delta.content)
        yield {
          type: 'assistant.text_delta',
          scope: this.scope,
          messageId,
          delta: delta.content,
        }
      }

      this.collectToolCallDeltas(delta.tool_calls, toolCallByIndex)
    }

    const parsedToolCalls = this.toToolCalls(toolCallByIndex)

    for (const toolCall of parsedToolCalls) {
      yield {
        type: 'assistant.tool_call',
        scope: this.scope,
        messageId,
        toolCall,
      }
    }

    const message: RuntimeMessage = {
      id: messageId,
      type: 'ai',
      content: assistantText.join(''),
      ...(assistantReasoning.length > 0
        ? {
            reasoning: assistantReasoning.join(''),
            reasoning_started_at_ms: reasoningStartedAtMs ?? Date.now(),
            reasoning_ended_at_ms: Date.now(),
          }
        : {}),
      ...(parsedToolCalls.length > 0 ? { tool_calls: parsedToolCalls } : {}),
    }

    yield {
      type: 'assistant.completed',
      scope: this.scope,
      message,
    }

    return { message, toolCalls: parsedToolCalls }
  }

  private collectToolCallDeltas(
    deltas: Array<OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall> | undefined,
    toolCallByIndex: Map<number, PartialToolCall>
  ) {
    if (!Array.isArray(deltas)) return

    for (const callDelta of deltas) {
      const index = callDelta.index
      if (typeof index !== 'number') continue

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

  private toToolCalls(toolCallByIndex: Map<number, PartialToolCall>): Array<ToolCall> {
    return Array.from(toolCallByIndex.values())
      .filter(toolCall => toolCall.name)
      .map(toolCall => ({
        id: toolCall.id || randomUUID(),
        name: toolCall.name,
        args: safeJsonParse(toolCall.rawArgs),
      }))
  }

  private async *executeToolCalls(
    toolCalls: Array<ToolCall>
  ): AsyncGenerator<SerializedStreamEvent, void, void> {
    for (const toolCall of toolCalls) {
      yield {
        type: 'tool.started',
        scope: this.scope,
        toolCallId: toolCall.id,
        name: toolCall.name,
        input: toolCall.args,
      }

      const toolResult = yield* this.executeTool(toolCall)

      yield {
        type: 'tool.completed',
        scope: this.scope,
        toolCallId: toolCall.id,
        output: toolResult.content,
        ...(toolResult.metadata ? { metadata: toolResult.metadata } : {}),
      }

      this.history.push({
        id: randomUUID(),
        type: 'tool',
        name: toolCall.name,
        tool_call_id: toolCall.id,
        content: toolResult.content,
        ...(toolResult.metadata ? { metadata: toolResult.metadata } : {}),
      })
    }
  }

  private async *executeTool(
    toolCall: ToolCall
  ): AsyncGenerator<SerializedStreamEvent, RuntimeToolOutput, void> {
    const tool = getToolByName(toolCall.name)
    if (!tool) {
      return normalizeRuntimeToolOutput(`Tool not found: ${toolCall.name}`)
    }

    const parsedInput = tool.inputSchema.safeParse(toolCall.args)
    if (!parsedInput.success) {
      return normalizeRuntimeToolOutput(`Invalid tool input: ${parsedInput.error.message}`)
    }

    try {
      const execution = tool.execute(parsedInput.data, {
        threadId: this.input.threadId,
        projectPath: this.input.projectPath,
        toolCallId: toolCall.id,
        runScope: this.scope,
      })

      if (isAsyncGenerator(execution)) {
        for (;;) {
          const next = await execution.next()
          if (next.done) {
            return next.value
          }

          yield {
            type: 'tool.delta',
            scope: this.scope,
            toolCallId: toolCall.id,
            data: next.value,
          }
        }
      }

      return await execution
    } catch (error) {
      return normalizeRuntimeToolOutput(error instanceof Error ? error.message : String(error))
    }
  }
}
