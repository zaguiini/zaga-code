import { z } from 'zod'

const httpMcpServerSchema = z.object({
  transport: z.literal('http'),
  url: z.url(),
})

const stdioMcpServerSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

const mcpServerSchema = z.discriminatedUnion('transport', [
  httpMcpServerSchema,
  stdioMcpServerSchema,
])

const settingsSchema = z.object({
  mcps: z.record(z.string(), mcpServerSchema),
})

export type Settings = z.infer<typeof settingsSchema>
export type McpServerConfig = z.infer<typeof mcpServerSchema>

/** Parses raw JSON string into Settings. Returns null if invalid or malformed. */
export function parseSettings(raw: string): Settings | null {
  try {
    const parsed = JSON.parse(raw)
    const result = settingsSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}
