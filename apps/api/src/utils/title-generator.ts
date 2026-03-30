import { ChatOpenAI } from '@langchain/openai'
import type { Client } from '@langchain/langgraph-sdk'
import { env } from '@/env'

/**
 * Generates a concise title (4-8 words) from a user message using the LLM.
 * Falls back to a truncated message preview if generation fails.
 */
export async function generateThreadTitle(messageContent: string): Promise<string> {
  try {
    // Use the same model as the main agent for consistency
    const llm = new ChatOpenAI({
      model: env.SUMMARIZATION_MODEL,
      configuration: { baseURL: env.LM_STUDIO_API_URL },
      apiKey: 'lm-studio',
      temperature: 0.5,
    })

    const prompt = `Generate a concise, descriptive title (16 words at most) for a conversation that starts with this message. Return ONLY the title, no quotes or explanations. Do not include "inquiry" or similar words in the title. If the user is asking a question, the title should be a question.

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
export async function generateAndUpdateThreadTitle(
  client: Client,
  threadId: string,
  firstUserMessage: string
): Promise<void> {
  const title = await generateThreadTitle(firstUserMessage)
  return updateThreadTitle(client, threadId, title)
}
