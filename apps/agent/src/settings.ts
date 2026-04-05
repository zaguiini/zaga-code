import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const httpMcpServerSchema = z.object({
  transport: z.literal('http'),
  url: z.url(),
})

const stdioMcpServerSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})

const mcpServerSchema = z.discriminatedUnion('transport', [
  httpMcpServerSchema,
  stdioMcpServerSchema,
])

const settingsSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default('qwen3.5-35b-a3b@6bit'),
  apiBase: z.string().default('http://localhost:1234/v1'),
  mcpServers: z.record(z.string(), mcpServerSchema),
})

export type Settings = z.infer<typeof settingsSchema>
export type McpServerConfig = z.infer<typeof mcpServerSchema>

/** Parses raw JSON string into Settings. Returns null if invalid or malformed. */
export function parseSettings(path?: string) {
  try {
    const raw = readFileSync(path ?? join(homedir(), '.zaga', 'settings.json'), 'utf-8')
    return settingsSchema.parse(JSON.parse(raw))
  } catch {
    return settingsSchema.parse({})
  }
}

export const settings = parseSettings()

export function isExternalProvider(s: Settings): s is Settings & { apiKey: string } {
  return typeof s.apiKey === 'string'
}
