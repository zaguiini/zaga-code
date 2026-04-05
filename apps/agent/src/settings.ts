import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

const settingsSchema = z.object({
  // If apiKey is present, uses this provider directly (any OpenAI-compatible API).
  // Otherwise, lmStudio is assumed: model is the lms model key, apiBase is the local server.
  apiKey: z.string().optional(),
  model: z.string().default('lmstudio-community/gemma-3-12b-it'),
  apiBase: z.string().default('http://localhost:1234/v1'),
})

export type Settings = z.infer<typeof settingsSchema>

function load(): Settings {
  try {
    const raw = readFileSync(join(homedir(), '.zaga', 'settings.json'), 'utf-8')
    return settingsSchema.parse(JSON.parse(raw))
  } catch {
    return settingsSchema.parse({})
  }
}

export const settings = load()

export function isExternalProvider(s: Settings): s is Settings & { apiKey: string } {
  return typeof s.apiKey === 'string'
}
