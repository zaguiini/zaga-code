import { describe, expect, it, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { createPlannerNode } from '@/nodes/planner'

const makeModel = (responseContent: string) => ({
  invoke: vi.fn().mockResolvedValue({ content: responseContent }),
})

describe('createPlannerNode', () => {
  it('returns plan string from model output', async () => {
    const model = makeModel('1. Read auth.ts\n2. Explain the logic')
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [new HumanMessage('explain the auth module')],
      complexity: 'simple',
      planningDepth: 'brief',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBe('1. Read auth.ts\n2. Explain the logic')
  })

  it('returns null plan when no human message', async () => {
    const model = makeModel('some plan')
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [],
      complexity: 'simple',
      planningDepth: 'brief',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBeNull()
  })

  it('returns null plan when model throws', async () => {
    const model = { invoke: vi.fn().mockRejectedValue(new Error('timeout')) }
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [new HumanMessage('refactor everything')],
      complexity: 'complex',
      planningDepth: 'decomposed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBeNull()
  })

  it('returns null when model returns empty content', async () => {
    const model = makeModel('   ')
    const node = createPlannerNode(model as any)
    const result = await node({
      messages: [new HumanMessage('do something')],
      complexity: 'medium',
      planningDepth: 'detailed',
      plan: null,
      critiqueAttempts: 0,
      critiqueFeedback: null,
    })
    expect(result.plan).toBeNull()
  })
})
