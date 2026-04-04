import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import matter from 'gray-matter'

export type AgentDefinition = {
  name: string
  description: string
  tools?: Array<string>
  systemPrompt: string
}

/** Parses a single agent .md file. Returns null if required fields are missing. */
export function parseAgentFile(content: string): AgentDefinition | null {
  const { data, content: body } = matter(content)

  if (typeof data.name !== 'string' || !data.name) {
    console.warn('[agent-loader] Skipping agent file: missing "name" in frontmatter')
    return null
  }
  if (typeof data.description !== 'string' || !data.description) {
    console.warn(
      `[agent-loader] Skipping agent "${data.name}": missing "description" in frontmatter`
    )
    return null
  }

  return {
    name: data.name,
    description: data.description,
    tools: Array.isArray(data.tools) ? data.tools : undefined,
    systemPrompt: body.trim(),
  }
}

/** Loads all .md agent definitions from a directory. Missing dir = empty array (no error). */
export async function loadAgentsFromDir(dir: string): Promise<Array<AgentDefinition>> {
  let files: Array<string>
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const definitions: Array<AgentDefinition> = []
  for (const file of files.filter(f => f.endsWith('.md'))) {
    try {
      const content = await readFile(join(dir, file), 'utf-8')
      const def = parseAgentFile(content)
      if (def) definitions.push(def)
    } catch {
      console.warn(`[agent-loader] Failed to read ${file}, skipping`)
    }
  }
  return definitions
}

/**
 * Merges agent definitions from all three layers.
 * Built-in names are locked — user/project agents with the same name are skipped with a warning.
 * Per-project overrides global user agents (same name = project wins).
 */
export function mergeAgentDefinitions(
  builtIns: Array<AgentDefinition>,
  global: Array<AgentDefinition>,
  project: Array<AgentDefinition>
): Array<AgentDefinition> {
  const builtInNames = new Set(builtIns.map(a => a.name))
  const result = new Map<string, AgentDefinition>()

  for (const def of builtIns) {
    result.set(def.name, def)
  }

  for (const def of global) {
    if (builtInNames.has(def.name)) {
      console.warn(`[agent-loader] Skipping "${def.name}": conflicts with built-in agent`)
      continue
    }
    result.set(def.name, def)
  }

  for (const def of project) {
    if (builtInNames.has(def.name)) {
      console.warn(`[agent-loader] Skipping "${def.name}": conflicts with built-in agent`)
      continue
    }
    result.set(def.name, def)
  }

  return Array.from(result.values())
}
