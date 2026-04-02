import { describe, expect, it } from 'vitest'
import { appReducer, initialState } from '../reducer'
import type { AppAction } from '../reducer'

describe('appReducer', () => {
  it('starts streaming on send', () => {
    const state = appReducer(initialState, { type: 'send', userMessage: 'hello' })
    expect(state.status).toBe('streaming')
    expect(state.activeResponse).toEqual({ text: '', tools: [] })
  })

  it('appends text chunks', () => {
    let state = appReducer(initialState, { type: 'send', userMessage: 'hello' })
    state = appReducer(state, { type: 'text_chunk', chunk: 'Hello ' })
    state = appReducer(state, { type: 'text_chunk', chunk: 'world' })
    expect(state.activeResponse!.text).toBe('Hello world')
  })

  it('tracks tool lifecycle', () => {
    let state = appReducer(initialState, { type: 'send', userMessage: 'test' })
    state = appReducer(state, {
      type: 'tool_start',
      toolCallId: 't1',
      name: 'shell',
      input: 'git status',
    })
    expect(state.activeResponse!.tools).toHaveLength(1)
    expect(state.activeResponse!.tools[0].status).toBe('running')

    state = appReducer(state, {
      type: 'tool_end',
      toolCallId: 't1',
      output: 'clean',
    })
    expect(state.activeResponse!.tools[0].status).toBe('done')
    expect(state.activeResponse!.tools[0].output).toBe('clean')
  })

  it('moves active response to history on stream end', () => {
    let state = appReducer(initialState, { type: 'send', userMessage: 'hello' })
    state = appReducer(state, { type: 'text_chunk', chunk: 'Hi there' })
    state = appReducer(state, { type: 'stream_end' })
    expect(state.status).toBe('idle')
    expect(state.activeResponse).toBeNull()
    expect(state.history).toHaveLength(1)
    expect(state.history[0].userMessage).toBe('hello')
    expect(state.history[0].assistantText).toBe('Hi there')
  })

  it('handles stream error', () => {
    let state = appReducer(initialState, { type: 'send', userMessage: 'hello' })
    state = appReducer(state, { type: 'stream_error', error: 'connection lost' })
    expect(state.status).toBe('idle')
    expect(state.history).toHaveLength(1)
    expect(state.history[0].assistantText).toContain('connection lost')
  })

  it('updates token count', () => {
    const state = appReducer(initialState, { type: 'update_tokens', count: 1200 })
    expect(state.tokenCount).toBe(1200)
  })
})
