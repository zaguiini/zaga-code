import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SystemMessage } from '@langchain/core/messages'
import type { BaseMessage } from 'langchain'
import type { AgentState } from '@/graphs/agent'
import { toolRegistry } from '@/config/registry'

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
- Prefer file_edit over file_write for modifying existing files.
- Use file_write only for creating new files or complete rewrites.
- When using file_edit, include 2-3 lines of surrounding context in old_string to ensure uniqueness.

**Verification:**
- If AGENTS.md specifies build, test, lint, or typecheck commands, run them after making changes — without asking. Fix any failures before reporting the task as done.
- If AGENTS.md does not mention any checks, do not guess or discover them yourself. Just complete the task.

**Reasoning and Tool Usage:**
- Think step-by-step about what information you need before making tool calls
- Use tools strategically - gather necessary context first, then take action
- When you have enough information to answer the user's question, provide a clear and helpful response
- If a tool call fails, reason about why it failed and try a different approach
`

const AGENTS_MD_PROMPT = `
${BASE_SYSTEM_PROMPT}\n\n
Use the following project-specific instructions to guide your actions:

{{agentsMd}}
`

function buildAgentsSection(configHash: string): string {
  const tools = toolRegistry.get(configHash)
  if (!tools) return ''

  const agentTools = tools.filter(t => t.name.startsWith('agent-'))
  if (agentTools.length === 0) return ''

  const lines = agentTools.map(t => `- **${t.name}**: ${t.description}`)
  return `\n**Specialist Agents:**\nUse these agents instead of doing the work yourself when they match the task:\n${lines.join('\n')}\n`
}

async function buildSystemPrompt(projectPath: string, configHash: string): Promise<BaseMessage> {
  const agentsSection = buildAgentsSection(configHash)

  if (projectPath) {
    try {
      const agentsMd = await readFile(join(projectPath, 'AGENTS.md'), 'utf-8')
      const base = AGENTS_MD_PROMPT.replace('{{agentsMd}}', agentsMd) + agentsSection
      return new SystemMessage(base)
    } catch {
      // AGENTS.md not found, fall through to base prompt
    }
  }

  return new SystemMessage(BASE_SYSTEM_PROMPT + agentsSection)
}

export async function systemPromptNode(state: AgentState): Promise<Partial<AgentState>> {
  const existingSystem = state.messages.find(msg => msg.type === 'system')

  // Skip rebuild if system message already exists
  if (existingSystem) return {}

  const systemMessage = await buildSystemPrompt(state.projectPath, state.configHash)
  return { messages: [systemMessage] }
}
