import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, normalize, relative, resolve } from 'node:path'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'
import { getModel } from '@/utils/get-model'

export type MemoryScope = 'project' | 'global'

export type ParsedMemoryCommand = {
  scope: MemoryScope
  content: string
}

export type MemoryNote = {
  name: string
  description: string
  type: string
  slug: string
  body: string
  originSessionId: string
}

const synthesizedNoteSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  type: z.string().min(1).default('feedback'),
  slug: z.string().min(1),
  body: z.string().min(1),
})

const indexEntryRegex = /^\s*-\s+\[([^\]]+)\]\(([^)]+)\)/

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n')
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'memory-note'
}

function buildMemoryPaths(scope: MemoryScope, projectPath?: string) {
  if (scope === 'project') {
    if (!projectPath) {
      throw new Error('Project path is required for project memory.')
    }
    const memoryDir = join(projectPath, '.zaga', 'memory')
    return {
      memoryDir,
      indexPath: join(memoryDir, 'MEMORY.md'),
    }
  }

  const memoryDir = join(homedir(), '.zaga', 'memory')
  return {
    memoryDir,
    indexPath: join(memoryDir, 'MEMORY.md'),
  }
}

function getResponseText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
}

function parseJsonObject(value: string): unknown {
  const trimmed = value.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('Model output did not include a JSON object.')
    }
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildNoteMarkdown(note: MemoryNote): string {
  return [
    '---',
    `name: ${note.name}`,
    `description: ${note.description}`,
    `type: ${note.type}`,
    `originSessionId: ${note.originSessionId}`,
    '---',
    note.body.trim(),
    '',
  ].join('\n')
}

export function parseMemoryCommand(text: string): ParsedMemoryCommand | null {
  const trimmed = text.trim()

  if (trimmed.startsWith('##')) {
    const rest = trimmed.slice(2)
    if (!/^\s/.test(rest)) return null
    const content = rest.trim()
    return content ? { scope: 'global', content } : null
  }

  if (trimmed.startsWith('#')) {
    const rest = trimmed.slice(1)
    if (!/^\s/.test(rest)) return null
    const content = rest.trim()
    return content ? { scope: 'project', content } : null
  }

  return null
}

export async function synthesizeMemoryNote(input: {
  commandContent: string
  scope: MemoryScope
  originSessionId: string
}): Promise<MemoryNote> {
  const model = getModel({ streaming: false })

  const response = await model.invoke(
    [
      new SystemMessage(`You write durable coding-assistant memory notes.
Return JSON only (no markdown fences) with exactly this shape:
{
  "name": "short title",
  "description": "single-sentence summary",
  "type": "feedback",
  "slug": "safe-file-slug",
  "body": "markdown body without frontmatter"
}

Rules:
- Produce exactly one memory note.
- Keep guidance durable and actionable for future coding sessions.
- Do not invent user intent beyond the request.
- type should be "feedback" unless a different type is clearly necessary.
- slug must be lowercase letters/numbers/hyphens only.`),
      new HumanMessage(
        `Scope: ${input.scope}\nOrigin session id: ${input.originSessionId}\nMemory request: ${input.commandContent}`
      ),
    ],
    {
      // Keep synthesis out of the main streamed event channel.
      callbacks: [],
    }
  )

  const parsed = synthesizedNoteSchema.parse(parseJsonObject(getResponseText(response.content)))
  const normalizedType = slugify(parsed.type).replace(/-/g, '_') || 'feedback'

  return {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    type: normalizedType,
    slug: slugify(parsed.slug || parsed.name),
    body: parsed.body.trim(),
    originSessionId: input.originSessionId,
  }
}

export async function writeMemoryNote(input: {
  scope: MemoryScope
  note: MemoryNote
  projectPath?: string
}): Promise<{ fileName: string; indexPath: string }> {
  const paths = buildMemoryPaths(input.scope, input.projectPath)
  await mkdir(paths.memoryDir, { recursive: true })

  const fileName = `${input.note.type}_${input.note.slug}.md`
  const notePath = join(paths.memoryDir, fileName)
  const noteMarkdown = buildNoteMarkdown(input.note)
  await writeFile(notePath, noteMarkdown, 'utf-8')

  let existingIndex = ''
  try {
    existingIndex = normalizeLineEndings(await readFile(paths.indexPath, 'utf-8')).trimEnd()
  } catch {
    // Index does not exist yet.
  }

  const entry = `- [${input.note.name}](${fileName}) — ${input.note.description}`
  const lines = existingIndex ? existingIndex.split('\n') : []
  const targetRegex = new RegExp(`\\[[^\\]]+\\]\\(${escapeRegExp(fileName)}\\)`)
  const existingLineIndex = lines.findIndex(line => targetRegex.test(line))

  if (existingLineIndex >= 0) {
    lines[existingLineIndex] = entry
  } else {
    lines.push(entry)
  }

  await writeFile(paths.indexPath, `${lines.join('\n')}\n`, 'utf-8')

  return { fileName, indexPath: paths.indexPath }
}

export type IndexedMemoryNote = {
  title: string
  fileName: string
  content: string
}

export async function loadIndexedMemory(
  scope: MemoryScope,
  projectPath?: string
): Promise<Array<IndexedMemoryNote>> {
  const paths = buildMemoryPaths(scope, projectPath)

  let indexRaw = ''
  try {
    indexRaw = normalizeLineEndings(await readFile(paths.indexPath, 'utf-8'))
  } catch {
    return []
  }

  const notes: Array<IndexedMemoryNote> = []
  for (const line of indexRaw.split('\n')) {
    const match = line.match(indexEntryRegex)
    if (!match) continue

    const [, title, rawLink] = match
    const fileName = basename(rawLink.trim())
    if (!fileName) continue

    const candidatePath = resolve(paths.memoryDir, normalize(fileName))
    const rel = relative(paths.memoryDir, candidatePath)
    if (rel.startsWith('..') || rel.includes('/') || rel.includes('\\')) continue

    try {
      const content = normalizeLineEndings(await readFile(candidatePath, 'utf-8')).trim()
      if (!content) continue
      notes.push({ title: title.trim(), fileName, content })
    } catch {
      // Ignore unreadable files.
    }
  }

  return notes
}
