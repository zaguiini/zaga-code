import { describe, expect, it, vi } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { createCriticNode, shouldRetry } from '@/nodes/critic'

const makeModel = (output: { approved: boolean; feedback: string }) => ({
  withStructuredOutput: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(output),
  }),
})

const baseState = {
  messages: [
    new HumanMessage('fix the null pointer bug'),
    new AIMessage('I fixed it by adding a null check'),
  ],
  complexity: 'medium' as const,
  planningDepth: 'detailed' as const,
  plan: '1. Read buggy.ts\n2. Fix null check',
  critiqueAttempts: 0,
  critiqueFeedback: null,
}

describe('createCriticNode', () => {
  it('increments critiqueAttempts on approval', async () => {
    const model = makeModel({ approved: true, feedback: 'Looks good' })
    const node = createCriticNode(model as any)
    const result = await node(baseState)
    expect(result.critiqueAttempts).toBe(1)
    expect(result.critiqueFeedback).toBeNull()
  })

  it('increments critiqueAttempts and sets feedback on rejection', async () => {
    const model = makeModel({ approved: false, feedback: 'Missing error handling in line 42' })
    const node = createCriticNode(model as any)
    const result = await node(baseState)
    expect(result.critiqueAttempts).toBe(1)
    expect(result.critiqueFeedback).toBe('Missing error handling in line 42')
  })

  it('treats model error as approval to avoid hanging', async () => {
    const model = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error('model error')),
      }),
    }
    const node = createCriticNode(model as any)
    const result = await node(baseState)
    expect(result.critiqueAttempts).toBe(1)
    expect(result.critiqueFeedback).toBeNull()
  })
})

describe('shouldRetry', () => {
  it('routes to executor when not approved and attempts <= 2', () => {
    const state = { ...baseState, critiqueAttempts: 1, critiqueFeedback: 'fix the null case' }
    expect(shouldRetry(state)).toBe('executor')
  })

  it('routes to __end__ when approved', () => {
    const state = { ...baseState, critiqueAttempts: 1, critiqueFeedback: null }
    expect(shouldRetry(state)).toBe('__end__')
  })

  it('routes to __end__ when attempts exceed cap', () => {
    const state = { ...baseState, critiqueAttempts: 3, critiqueFeedback: 'still broken' }
    expect(shouldRetry(state)).toBe('__end__')
  })
})
