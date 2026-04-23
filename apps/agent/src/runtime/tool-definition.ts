import { z } from 'zod'
import type { ToolContext } from './tool-context'
import type { RuntimeToolOutput } from './tool-output'

export type RuntimeToolExecute<TInput extends Record<string, unknown>, TDelta = unknown> = (
  input: TInput,
  ctx: ToolContext
) => Promise<RuntimeToolOutput> | AsyncGenerator<TDelta, RuntimeToolOutput, void>

export type RuntimeToolDefinition<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TDelta = unknown,
> = {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  execute: RuntimeToolExecute<TInput, TDelta>
}

export function inputSchemaToJsonSchema(inputSchema: z.ZodType) {
  const schema = z.toJSONSchema(inputSchema, { io: 'input' })
  return schema
}

export function isAsyncGenerator<TDelta>(
  value: unknown
): value is AsyncGenerator<TDelta, RuntimeToolOutput, void> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  return Symbol.asyncIterator in value
}
