import { ChatOpenAI } from '@langchain/openai'
import type { Client } from '@langchain/langgraph-sdk'
import { env } from '@/env'

/**
 * Generates a concise title (4-8 words) from a user message using the LLM.
 * Falls back to a truncated message preview if generation fails.
 */
export async function generateThreadTitle(messageContent: string): Promise<string> {
  try {
    const llm = new ChatOpenAI({
      model: env.FAST_MODEL,
      configuration: { baseURL: env.MODEL_API_BASE_URL },
      apiKey: 'local',
      temperature: 0.5,
    })

    const prompt = `Write a concise conversation title.

Rules:
- Return only the title text (no quotes, labels, markdown, or explanation).
- Use sentence case.
- Maximum 16 words.
- Do not use words like "inquiry", "request", "question", or "help".
- Keep it specific to the user's message.

User message: ${messageContent}

Title:`

    const response = await llm.invoke(prompt)
    const rawTitle = response.content.toString().trim()
    const title = normalizeTitle(rawTitle)

    if (title && title.length > 0 && title.length < 100) {
      return title
    }

    return createFallbackTitle(messageContent)
  } catch (error) {
    console.error('Failed to generate thread title:', error)
    return createFallbackTitle(messageContent)
  }
}

function createFallbackTitle(messageContent: string): string {
  const maxLength = 50
  if (messageContent.length <= maxLength) {
    return messageContent
  }
  return messageContent.substring(0, maxLength).trim() + '...'
}

function normalizeTitle(rawTitle: string): string {
  let title = rawTitle
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  title = title
    .replace(/\b(inquiry|request|question|help)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  const words = title.split(' ').filter(Boolean)
  if (words.length > 16) {
    title = words.slice(0, 16).join(' ')
  }

  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase()
  }

  return title.trim()
}

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

export async function generateAndUpdateThreadTitle(
  client: Client,
  threadId: string,
  firstUserMessage: string
): Promise<void> {
  const title = await generateThreadTitle(firstUserMessage)
  return updateThreadTitle(client, threadId, title)
}
