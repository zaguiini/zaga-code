import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const httpMcpServerSchema = z.object({
  transport: z.literal('http'),
  url: z.url(),
  enabled: z.boolean().default(true),
})

const stdioMcpServerSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
})

const mcpServerSchema = z.discriminatedUnion('transport', [
  httpMcpServerSchema,
  stdioMcpServerSchema,
])

export const settingsSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default('qwen3.6-35b-a3b@4bit'),
  apiBase: z.string().default('http://localhost:1234/v1'),
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
})

export type Settings = z.infer<typeof settingsSchema>
export type McpServerConfig = z.infer<typeof mcpServerSchema>

export const GLOBAL_SETTINGS_PATH = join(homedir(), '.zaga', 'settings.json')

export function parseSettings() {
  try {
    const raw = readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8')
    return settingsSchema.parse(JSON.parse(raw))
  } catch {
    return settingsSchema.parse({})
  }
}

export async function writeSettings(data: Settings) {
  await mkdir(dirname(GLOBAL_SETTINGS_PATH), { recursive: true })
  await writeFile(GLOBAL_SETTINGS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}
