import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createAgent } from './graph'
import { langChainToNDJSON } from './stream-bridge'

export const chatServerFn = createServerFn({
  method: 'POST',
})
  .inputValidator(
    z.object({
      messages: z.array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })
      ),
      projectPath: z.string(),
      model: z.string().default('qwen3:1.7b'),
    })
  )
  .handler(async ({ data: { messages, projectPath, model } }) => {
    // Check if path exists and is accessible
    try {
      await access(projectPath, constants.R_OK)
    } catch (error) {
      return Response.json(
        { error: `Project path does not exist or is not accessible: ${projectPath}` },
        { status: 400 }
      )
    }

    const agent = await createAgent({ projectPath, model })

    // Convert messages to LangChain format
    const langChainMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))

    // Stream agent response
    // Use 'updates' mode which is reliably supported by LangChain agents
    try {
      const agentStream = await agent.stream(
        {
          messages: langChainMessages,
        },
        { streamMode: 'updates' }
      )

      // Convert to NDJSON format
      const ndjsonStream = langChainToNDJSON(agentStream, model)

      // Create ReadableStream from async generator
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of ndjsonStream) {
              // Enqueue each chunk immediately - ReadableStream handles flushing
              controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
          } catch (error) {
            console.error('Stream error:', error)
            const errorChunk =
              JSON.stringify({
                type: 'error',
                id: `chat-${Date.now()}`,
                model,
                timestamp: Date.now(),
                error: {
                  message: error instanceof Error ? error.message : 'Unknown error',
                  code: 'STREAM_ERROR',
                },
              }) + '\n'
            controller.enqueue(encoder.encode(errorChunk))
            controller.close()
          }
        },
      })

      // Return streaming response with proper headers
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no', // Disable nginx buffering if present
        },
      })
    } catch (error) {
      console.error('Error in chatServerFn:', error)
      throw error
    }
  })
