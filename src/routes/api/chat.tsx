import { createFileRoute } from '@tanstack/react-router'
import { chatServerFn } from '@/agent/chat.server'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Parse request body
          const body = await request.json()
          const { messages, data } = body as {
            messages: Array<{ role: 'user' | 'assistant'; content: string }>
            data: {
              projectPath: string
              conversationId: string
            }
          }

          return chatServerFn({
            data: {
              messages,
              projectPath: data.projectPath,
              model: 'qwen3:1.7b',
            },
          })
        } catch (error) {
          console.error('Error in /api/chat:', error)
          return Response.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
          )
        }
      },
    },
  },
})
