import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SystemMessage } from '@langchain/core/messages'
import { toolRegistry } from '@/config/registry'
import { loadIndexedMemory } from '@/utils/memory'

const BASE_SYSTEM_PROMPT = `You are an AI developer assistant that helps users with coding tasks.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- NEVER tell the user to do something themselves. If the task requires a file change, shell command, or any action — you do it using the available tools. Do not say "you should", "you need to", "make sure to", or "run this command".
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root (e.g., "src/agent/tools/file-read.ts", NOT absolute paths like "/Users/..."). Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- For searching files by NAME or PATH (e.g., "read auth.ts", "describe package.json", etc.), use the file_search tool to find the file.
- For searching file CONTENTS, use the grep tool with a regex pattern. Use the glob parameter to limit to specific file types.
- If the user message includes URL(s), use the web_fetch tool to retrieve the page content when it is relevant to answering the request.
- Prefer file_edit over file_write for modifying existing files.
- Use file_write only for creating new files or complete rewrites.
- When using file_edit, include 2-3 lines of surrounding context in old_string to ensure uniqueness.

**Verification:**
- If AGENTS.md specifies build, test, lint, or typecheck commands, run them after making changes — without asking. Fix any failures before reporting the task as done.
- If AGENTS.md does not mention any checks, do not guess or discover them yourself. Just complete the task.

**Reasoning and Tool Usage:**
- Think step-by-step about what information you need before making tool calls
- Use tools strategically - gather necessary context first, then take action
- For time-sensitive or externally changing facts (e.g., sports fixtures, stock/crypto prices, weather, news, releases, schedules, leadership roles, "latest" queries), you MUST verify with tools and never answer from memory.
- When a question depends on the current date/time, treat the provided "Today is ..." line as authoritative context and use it to compute relative dates like "tomorrow" before answering. Bonus points if you can pass it to the tool you're going to call.
- When you have enough information to answer the user's question, provide a clear and helpful response
- If a tool call fails, reason about why it failed and try a different approach
`

function formatTodayLine(
  date: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  const resolvedTimeZone = timeZone || 'UTC'

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: resolvedTimeZone,
    year: 'numeric',
  }).format(date)

  return `Today is ${formattedDate} (${resolvedTimeZone}). Treat this as authoritative. For time-sensitive questions, verify with tools and use concrete dates in your answer.`
}

function buildBaseSystemPrompt(): string {
  return `${formatTodayLine()}\n\n${BASE_SYSTEM_PROMPT}`
}

function buildAgentsMdPrompt(baseSystemPrompt: string, agentsMd: string): string {
  return `${baseSystemPrompt}\n\nUse the following project-specific instructions to guide your actions:\n\n${agentsMd}`
}

function buildAgentsSection(configHash: string): string {
  const tools = toolRegistry.get(configHash)
  if (!tools) return ''

  const agentTools = tools.filter(t => t.name.startsWith('agent_'))
  if (agentTools.length === 0) return ''

  const lines = agentTools.map(t => `- **${t.name}**: ${t.description}`)
  return `\n**Specialist Agents:**\nUse these agents instead of doing the work yourself when they match the task:\n${lines.join('\n')}\n`
}

function buildMemorySection(
  title: string,
  notes: Array<{ fileName: string; content: string }>
): string {
  if (notes.length === 0) return ''

  const chunks = notes.map(note => `\n### ${note.fileName}\n${note.content}`)
  return `\n\n## ${title}\n${chunks.join('\n')}\n`
}

export async function buildSystemPrompt(projectPath: string, configHash: string) {
  const agentsSection = buildAgentsSection(configHash)
  const baseSystemPrompt = buildBaseSystemPrompt()
  const promptChunks: Array<string> = [baseSystemPrompt]

  if (projectPath) {
    try {
      const agentsMd = await readFile(join(projectPath, 'AGENTS.md'), 'utf-8')
      promptChunks[0] = buildAgentsMdPrompt(baseSystemPrompt, agentsMd)
    } catch {
      // AGENTS.md not found, fall through to base prompt
    }
  }

  try {
    const globalMemory = await loadIndexedMemory('global')
    promptChunks.push(buildMemorySection('Global Memory', globalMemory))
  } catch {
    // Fail soft: omit broken memory scope.
  }

  if (projectPath) {
    try {
      const projectMemory = await loadIndexedMemory('project', projectPath)
      promptChunks.push(buildMemorySection('Project Memory', projectMemory))
    } catch {
      // Fail soft: omit broken memory scope.
    }
  }

  promptChunks.push(agentsSection)

  return new SystemMessage(promptChunks.filter(Boolean).join(''))
}
