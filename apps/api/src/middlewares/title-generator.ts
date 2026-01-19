import { ChatOllama } from '@langchain/ollama'
import { HumanMessage, createMiddleware } from 'langchain'
import { Client } from '@langchain/langgraph-sdk'
import { z } from 'zod'
import { env } from '@/env'

/**
 * Generates a concise title (4-8 words) from a user message using the LLM.
 * Falls back to a truncated message preview if generation fails.
 */
export async function generateThreadTitle(messageContent: string): Promise<string> {
  try {
    // Use the same model as the main agent for consistency
    const llm = new ChatOllama({
      model: env.AGENT_MODEL,
      temperature: 0.5, // Slightly higher temp for more creative titles
    })

    const prompt = `Generate a concise, descriptive title (4-8 words) for a conversation that starts with this message. Return ONLY the title, no quotes or explanations.

User message: ${messageContent}

Title:`

    const response = await llm.invoke(prompt)
    const title = response.content.toString().trim()

    // Validate and clean the title
    if (title && title.length > 0 && title.length < 100) {
      // Remove surrounding quotes if present
      return title.replace(/^["']|["']$/g, '')
    }

    // Fallback to message preview
    return createFallbackTitle(messageContent)
  } catch (error) {
    console.error('Failed to generate thread title:', error)
    return createFallbackTitle(messageContent)
  }
}

/**
 * Creates a fallback title by truncating the message content.
 */
function createFallbackTitle(messageContent: string): string {
  const maxLength = 50
  if (messageContent.length <= maxLength) {
    return messageContent
  }
  return messageContent.substring(0, maxLength).trim() + '...'
}

/**
 * Updates the thread metadata with a generated title.
 */
async function updateThreadTitle(client: Client, threadId: string, title: string): Promise<void> {
  try {
    await client.threads.update(threadId, {
      metadata: { title },
    })
  } catch (error) {
    console.error(`Failed to update thread ${threadId} with title:`, error)
    throw error
  }
}

/**
 * Generates and updates a thread title in one operation.
 * This is the main function to call after the first message in a thread.
 */
async function generateAndUpdateThreadTitle(
  client: Client,
  threadId: string,
  firstUserMessage: string
): Promise<void> {
  try {
    const title = await generateThreadTitle(firstUserMessage)
    await updateThreadTitle(client, threadId, title)
  } catch (error) {
    console.error(`Failed to generate and update title for thread ${threadId}:`, error)
    // Don't throw - this is a non-critical feature
  }
}

export const titleGeneratorMiddleware = createMiddleware({
  name: 'TitleGenerator',
  stateSchema: z.object({
    // We should be able to get the threadId from the context, but for some reason we aren't.
    // Yes, I've tried beforeModel and afterAgent.
    threadId: z.string().describe('The ID of the thread'),
  }),
  beforeAgent: ({ messages, threadId }) => {
    if (messages.length > 1 || !threadId) {
      return
    }

    const [firstMessage] = messages

    if (!HumanMessage.isInstance(firstMessage)) {
      return
    }

    const langGraphClient = new Client({
      apiUrl: env.LANGGRAPH_API_URL,
    })

    generateAndUpdateThreadTitle(
      langGraphClient,
      threadId,
      typeof firstMessage.content === 'string'
        ? firstMessage.content
        : firstMessage.content.map(content => content.text).join('')
    )

    return
  },
})
