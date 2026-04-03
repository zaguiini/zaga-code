import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RemoveMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage, Runtime } from 'langchain'
import type { AgentState } from '@/graphs/agent'

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

**External Libraries and Documentation:**
- If the user's question or task involves an external library, package, or framework (e.g. "what are the X classes in tailwind", "how do I use Y in react", "show me Z from lodash"), your FIRST tool call MUST be to Context7 to fetch the documentation. Do NOT search the project files first. Do NOT use your training knowledge. Call Context7 immediately as the very first action.

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

type AgentContext = {
  project_path: string
}

const isAgentContext = (context: unknown): context is AgentContext => {
  return typeof context === 'object' && context !== null && 'project_path' in context
}

function buildSystemPromptContent(base: string, critiqueFeedback: string | null): string {
  let content = base

  if (critiqueFeedback) {
    content += `\n\n## Previous Attempt Feedback\n\nA previous attempt was reviewed and found these issues. Fix them:\n\n${critiqueFeedback}`
  }

  return content
}

async function buildSystemPrompt(
  runtime: Runtime,
  critiqueFeedback: string | null
): Promise<BaseMessage> {
  if (isAgentContext(runtime.context)) {
    try {
      const agentsMd = await readFile(join(runtime.context.project_path, 'AGENTS.md'), 'utf-8')
      const base = AGENTS_MD_PROMPT.replace('{{agentsMd}}', agentsMd)
      return new SystemMessage(buildSystemPromptContent(base, critiqueFeedback))
    } catch {
      // AGENTS.md not found, fall through to base prompt
    }
  }

  return new SystemMessage(buildSystemPromptContent(BASE_SYSTEM_PROMPT, critiqueFeedback))
}

export async function systemPromptNode(
  state: AgentState,
  runtime: Runtime
): Promise<Partial<AgentState>> {
  const existingSystem = state.messages.find(msg => msg.type === 'system')

  // Skip rebuild if system message exists and we're not on a retry path
  if (existingSystem && !state.critiqueFeedback) return {}

  const systemMessage = await buildSystemPrompt(runtime, state.critiqueFeedback)

  // MessagesAnnotation uses an additive reducer. To replace the system
  // message, remove the old one first then add the new one.
  if (existingSystem) {
    return {
      messages: [new RemoveMessage({ id: existingSystem.id! }), systemMessage],
    }
  }
  return { messages: [systemMessage] }
}
