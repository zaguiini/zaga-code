import { describe, expect, it, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { createRouterNode } from '@/nodes/router'

const makeModel = (output: { complexity: string; planningDepth: string }) => ({
  withStructuredOutput: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(output),
  }),
})

describe('createRouterNode', () => {
  it('returns complexity and planningDepth from model output', async () => {
    const model = makeModel({ complexity: 'simple', planningDepth: 'brief' })
    const node = createRouterNode(model as any)
    const result = await node({
      messages: [new HumanMessage('explain this function')],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.complexity).toBe('simple')
    expect(result.planningDepth).toBe('brief')
  })

  it('defaults to medium/detailed when no human message', async () => {
    const model = makeModel({ complexity: 'simple', planningDepth: 'brief' })
    const node = createRouterNode(model as any)
    const result = await node({
      messages: [],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.complexity).toBe('medium')
    expect(result.planningDepth).toBe('detailed')
  })

  it('defaults to medium/detailed when model throws', async () => {
    const model = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error('model error')),
      }),
    }
    const node = createRouterNode(model as any)
    const result = await node({
      messages: [new HumanMessage('refactor everything')],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.complexity).toBe('medium')
    expect(result.planningDepth).toBe('detailed')
  })
})
