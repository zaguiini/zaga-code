import type { z } from 'zod'
import type { ToolContext } from './tool-context'

export type JsonSchemaObject = {
  type: 'object'
  properties: Record<string, unknown>
  required?: Array<string>
  additionalProperties?: boolean
}

export type RuntimeToolExecute<TInput extends Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  ctx: ToolContext
) => Promise<TOutput> | AsyncGenerator<unknown, TOutput, void>

export type RuntimeToolDefinition<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput = unknown,
> = {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  jsonSchema: JsonSchemaObject
  execute: RuntimeToolExecute<TInput, TOutput>
}

export function isAsyncGenerator(value: unknown): value is AsyncGenerator<unknown, unknown, void> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  return Symbol.asyncIterator in value
}
