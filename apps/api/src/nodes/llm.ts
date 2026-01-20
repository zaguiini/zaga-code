import { SystemMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import type { BaseMessage } from 'langchain'

/**
 * System prompt describing the AI developer assistant's role and capabilities.
 */
const SYSTEM_PROMPT = `You are an AI developer assistant that helps users with coding tasks.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root (e.g., "src/agent/tools/file-read.ts", NOT absolute paths like "/Users/..."). Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- For semantic searches through file CONTENTS (e.g., "where is the authentication code?", "find database setup"), ALWAYS use the rag_file_search tool.
- For searching files by NAME or PATH (e.g., "read auth.ts", "describe package.json", etc.), use the file_search tool FIRST to find the file.

**Reasoning and Tool Usage:**
- Think step-by-step about what information you need before making tool calls
- Use tools strategically - gather necessary context first, then take action
- When you have enough information to answer the user's question, provide a clear and helpful response
- If a tool call fails, reason about why it failed and try a different approach
`

type AgentState = {
  messages: Array<BaseMessage>
}

/**
 * Creates the LLM node function that calls the model with tools bound.
 * This node implements the "think" and "act" phases of ReAct.
 */
export function createLlmNode(modelWithTools: Runnable<Array<BaseMessage>>) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const { messages } = state

    // Prepare messages with system prompt
    // Only add system message if it's not already in the thread
    const messagesWithSystem = messages.some(
      (msg): msg is SystemMessage => msg instanceof SystemMessage
    )
      ? messages
      : [new SystemMessage(SYSTEM_PROMPT), ...messages]

    // Invoke the model - it will reason about the task and decide whether to use tools
    const response = await modelWithTools.invoke(messagesWithSystem)

    // Return the response to be added to the state
    return { messages: [response] }
  }
}
