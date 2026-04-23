import { z } from 'zod'
import type { RuntimeToolDefinition } from '@/runtime/tool-definition'

const MAX_OUTPUT_CHARS = 12_000
const FETCH_TIMEOUT_MS = 15_000

export const webFetchSchema = z.object({
  url: z.string().url().describe('Absolute HTTP(S) URL to fetch and summarize as text'),
})

type WebFetchInput = z.infer<typeof webFetchSchema>

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function sanitizeHtmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')

  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ')
  return collapseWhitespace(decodeHtmlEntities(withoutTags))
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input
  return `${input.slice(0, maxChars)}\n\n[truncated ${input.length - maxChars} chars]`
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match || !match[1]) return null
  const title = collapseWhitespace(decodeHtmlEntities(match[1]))
  return title.length > 0 ? title : null
}

async function executeWebFetch(input: WebFetchInput) {
  let parsed: URL

  try {
    parsed = new URL(input.url)
  } catch {
    return { content: 'Invalid URL.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { content: `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.` }
  }

  try {
    const response = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'zaga-code-agent/web-fetch',
        accept: 'text/html,text/plain,application/json,*/*;q=0.8',
      },
    })

    const contentType = response.headers.get('content-type') ?? 'unknown'
    const statusLine = `${response.status} ${response.statusText}`.trim()
    const rawBody = await response.text()

    const isHtml = contentType.toLowerCase().includes('text/html')
    const title = isHtml ? extractTitle(rawBody) : null
    const bodyText = isHtml ? sanitizeHtmlToText(rawBody) : collapseWhitespace(rawBody)

    const body = truncate(bodyText, MAX_OUTPUT_CHARS)

    return {
      content: [
        `URL: ${parsed.toString()}`,
        `Status: ${statusLine}`,
        `Content-Type: ${contentType}`,
        ...(title ? [`Title: ${title}`] : []),
        '',
        body || '[empty response body]',
      ].join('\n'),
      metadata: {
        url: parsed.toString(),
        status: statusLine,
        contentType,
        ...(title ? { title } : {}),
      },
    }
  } catch (error) {
    if (error instanceof Error) {
      return { content: `Error fetching URL: ${error.message}` }
    }
    return { content: `Error fetching URL: ${String(error)}` }
  }
}

export const webFetchTool: RuntimeToolDefinition<WebFetchInput> = {
  name: 'web_fetch',
  description:
    'Fetch a public URL and return a concise text extraction with status and content metadata.',
  inputSchema: webFetchSchema,
  execute: async input => executeWebFetch(input),
}
