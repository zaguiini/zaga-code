import type OpenAI from 'openai'

export const MODEL_CAPABILITY_UNSUPPORTED = 'MODEL_CAPABILITY_UNSUPPORTED'

export async function assertStructuredToolSupport(client: OpenAI, model: string): Promise<void> {
  const completion = await client.chat.completions.create({
    model,
    stream: false,
    messages: [{ role: 'user', content: 'Call tool_ping with {"value":"ok"}.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'tool_ping',
          description: 'Probe structured tool support.',
          parameters: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'tool_ping' } },
  })

  const toolCalls = completion.choices[0]?.message?.tool_calls ?? []
  if (toolCalls.length === 0) {
    throw new Error(`${MODEL_CAPABILITY_UNSUPPORTED}: structured tool calls not emitted`)
  }
}
