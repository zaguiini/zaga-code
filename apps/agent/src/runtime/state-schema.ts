import { z } from 'zod'

export const toolBoundarySchema = z.object({
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.unknown().optional(),
})

export const modelBoundarySchema = z.object({
  messageId: z.string().optional(),
  content: z.unknown().optional(),
  tool_calls: z.array(z.unknown()).optional(),
})

export const dbStateBoundarySchema = z.object({
  threadId: z.string().min(1),
  messages: z.array(z.unknown()),
})
