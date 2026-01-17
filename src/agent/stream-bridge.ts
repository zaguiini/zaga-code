/**
 * Stream bridge that converts LangChain agent streams to TanStack AI NDJSON format.
 *
 * This module handles the conversion from LangChain's streaming format (with streamMode: 'messages' or 'updates')
 * to TanStack AI's NDJSON format expected by the client.
 *
 * streamMode: 'messages' - Streams message objects directly (better for token-by-token streaming)
 * streamMode: 'updates' - Streams step updates (only yields when steps complete)
 */

interface TanStackAIContentChunk {
  type: 'content'
  id: string
  model: string
  timestamp: number
  delta: string
  content: string
  role: 'assistant'
}

interface TanStackAIToolCallChunk {
  type: 'tool_call'
  id: string
  model: string
  timestamp: number
  toolCall: {
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }
  index: number
}

interface TanStackAIToolResultChunk {
  type: 'tool_result'
  id: string
  model: string
  timestamp: number
  toolCallId: string
  content: string
}

interface TanStackAIDoneChunk {
  type: 'done'
  id: string
  model: string
  timestamp: number
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
}

interface TanStackAIErrorChunk {
  type: 'error'
  id: string
  model: string
  timestamp: number
  error: {
    message: string
    code?: string
  }
}

type TanStackAIChunk =
  | TanStackAIContentChunk
  | TanStackAIToolCallChunk
  | TanStackAIToolResultChunk
  | TanStackAIDoneChunk
  | TanStackAIErrorChunk

/**
 * Converts LangChain agent stream to TanStack AI NDJSON format.
 *
 * @param agentStream - The LangChain agent stream (from agent.stream() with streamMode: 'messages' or 'updates')
 * @param model - The model name (for chunk metadata)
 * @param chatId - Unique ID for this chat session
 * @returns Async generator yielding NDJSON-formatted strings
 */
export async function* langChainToNDJSON(
  agentStream: AsyncIterable<any>,
  model: string,
  chatId: string = `chat-${Date.now()}`
): AsyncGenerator<string, void, unknown> {
  let accumulatedContent = ''
  let toolCallIndex = 0
  const startTime = Date.now()

  try {
    for await (const chunk of agentStream) {
      const timestamp = Date.now()

      // Helper function to extract message content and return delta
      const extractContent = (content: string): string | null => {
        if (!content || typeof content !== 'string') return null
        const newContent = content
        const delta = newContent.slice(accumulatedContent.length)
        if (delta) {
          accumulatedContent = newContent
          return delta
        }
        return null
      }

      // Helper to recursively find string content in nested structures
      const findStringContent = (obj: any): string | null => {
        if (typeof obj === 'string' && obj.trim()) {
          return obj
        }
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = findStringContent(item)
            if (found) return found
          }
        }
        if (obj && typeof obj === 'object') {
          // Check common content fields
          if ('content' in obj && typeof obj.content === 'string') {
            return obj.content
          }
          if ('text' in obj && typeof obj.text === 'string') {
            return obj.text
          }
          if ('response' in obj && typeof obj.response === 'string') {
            return obj.response
          }
          // Recursively search
          for (const value of Object.values(obj)) {
            const found = findStringContent(value)
            if (found) return found
          }
        }
        return null
      }

      // Handle streamMode: 'updates' - chunks are objects with step names as keys
      if (chunk && typeof chunk === 'object' && !Array.isArray(chunk)) {
        // Check if it's in 'updates' format (object with step names as keys)
        if (
          Object.keys(chunk).length > 0 &&
          Object.keys(chunk).some(key => typeof key === 'string')
        ) {
          for (const [stepName, stepContent] of Object.entries(chunk)) {
            // Check for agent/LLM responses - be more inclusive
            const isAgentStep =
              stepName.includes('agent') ||
              stepName.includes('llm') ||
              stepName.includes('model') ||
              stepName.includes('chat') ||
              stepName === '__end__' ||
              stepName === 'messages' ||
              (!stepName.includes('tool') &&
                !stepName.includes('action') &&
                !stepName.includes('execute'))

            if (isAgentStep) {
              // Agent/LLM responses - convert to content chunks
              let delta: string | null = null

              if (stepContent && typeof stepContent === 'object') {
                // Check if it's a message with content
                if ('content' in stepContent && typeof stepContent.content === 'string') {
                  delta = extractContent(stepContent.content)
                }
                // Check if it's an array of messages
                else if (Array.isArray(stepContent)) {
                  for (const msg of stepContent) {
                    if (msg?.content && typeof msg.content === 'string') {
                      const extracted = extractContent(msg.content)
                      if (extracted) delta = extracted
                    }
                  }
                }
                // Check if stepContent has a messages array
                else if ('messages' in stepContent && Array.isArray(stepContent.messages)) {
                  for (const msg of stepContent.messages) {
                    if (msg?.content && typeof msg.content === 'string') {
                      const extracted = extractContent(msg.content)
                      if (extracted) delta = extracted
                    }
                  }
                }
                // Check if stepContent has a response field
                else if ('response' in stepContent && typeof stepContent.response === 'string') {
                  delta = extractContent(stepContent.response)
                }
                // Check if stepContent has an answer field
                else if ('answer' in stepContent && typeof stepContent.answer === 'string') {
                  delta = extractContent(stepContent.answer)
                }
                // Fallback: try recursive search for content
                else {
                  const foundContent = findStringContent(stepContent)
                  if (foundContent) {
                    delta = extractContent(foundContent)
                  }
                }
              }
              // Handle case where stepContent is directly a string
              else if (typeof stepContent === 'string' && stepContent.trim()) {
                delta = extractContent(stepContent)
              }

              // Yield content chunk if we found new content
              if (delta) {
                const contentChunk: TanStackAIContentChunk = {
                  type: 'content',
                  id: chatId,
                  model,
                  timestamp,
                  delta,
                  content: accumulatedContent,
                  role: 'assistant',
                }
                yield JSON.stringify(contentChunk) + '\n'
              }
            } else if (stepName.includes('tool') || stepName.includes('action')) {
              // Tool calls - convert to tool_call chunks
              if (stepContent && typeof stepContent === 'object') {
                // Handle tool calls
                if ('tool' in stepContent || 'name' in stepContent) {
                  const toolName = stepContent.tool || stepContent.name || 'unknown'
                  const toolInput =
                    stepContent.input || stepContent.tool_input || stepContent.arguments || {}

                  const toolCallChunk: TanStackAIToolCallChunk = {
                    type: 'tool_call',
                    id: chatId,
                    model,
                    timestamp,
                    toolCall: {
                      id: `call_${toolCallIndex}_${Date.now()}`,
                      type: 'function',
                      function: {
                        name: toolName,
                        arguments:
                          typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput),
                      },
                    },
                    index: toolCallIndex++,
                  }
                  yield JSON.stringify(toolCallChunk) + '\n'
                }
                // Handle tool results
                else if ('output' in stepContent || 'result' in stepContent) {
                  const toolResult = stepContent.output || stepContent.result || ''
                  const toolCallId = stepContent.tool_call_id || `call_${toolCallIndex - 1}`

                  const toolResultChunk: TanStackAIToolResultChunk = {
                    type: 'tool_result',
                    id: chatId,
                    model,
                    timestamp,
                    toolCallId: String(toolCallId),
                    content:
                      typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                  }
                  yield JSON.stringify(toolResultChunk) + '\n'
                }
              }
            }
          }
        }
      }
    }

    // Send done chunk when stream completes
    const doneChunk: TanStackAIDoneChunk = {
      type: 'done',
      id: chatId,
      model,
      timestamp: Date.now(),
      finishReason: 'stop',
    }
    yield JSON.stringify(doneChunk) + '\n'
  } catch (error) {
    // Send error chunk on failure
    const errorChunk: TanStackAIErrorChunk = {
      type: 'error',
      id: chatId,
      model,
      timestamp: Date.now(),
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        code: 'STREAM_ERROR',
      },
    }
    yield JSON.stringify(errorChunk) + '\n'
    throw error
  }
}
