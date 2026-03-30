import { describe, expect, it } from 'vitest'
import z from 'zod'

describe('env schema', () => {
  it('parses valid env with new model vars', async () => {
    const envSchema = z.object({
      REASONING_MODEL: z.string(),
      CODING_MODEL: z.string(),
      LM_STUDIO_API_URL: z.url(),
      SUMMARIZATION_MODEL: z.string(),
      OLLAMA_API_URL: z.url(),
      LANGGRAPH_API_URL: z.url(),
      DATABASE_URL: z.url(),
    })

    const testEnv = {
      REASONING_MODEL: 'qwen3-30b',
      CODING_MODEL: 'qwen3-coder-30b',
      LM_STUDIO_API_URL: 'http://localhost:1234/v1',
      SUMMARIZATION_MODEL: 'qwen3-30b',
      OLLAMA_API_URL: 'http://localhost:11434',
      LANGGRAPH_API_URL: 'http://localhost:2024',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    }

    const result = envSchema.parse(testEnv)
    expect(result.REASONING_MODEL).toBe('qwen3-30b')
    expect(result.CODING_MODEL).toBe('qwen3-coder-30b')
    expect(result.LM_STUDIO_API_URL).toBe('http://localhost:1234/v1')
  })

  it('throws when REASONING_MODEL is missing', () => {
    const envSchema = z.object({
      REASONING_MODEL: z.string(),
      CODING_MODEL: z.string(),
      LM_STUDIO_API_URL: z.url(),
      SUMMARIZATION_MODEL: z.string(),
      OLLAMA_API_URL: z.url(),
      LANGGRAPH_API_URL: z.url(),
      DATABASE_URL: z.url(),
    })

    const testEnv = {
      CODING_MODEL: 'qwen3-coder-30b',
      LM_STUDIO_API_URL: 'http://localhost:1234/v1',
      SUMMARIZATION_MODEL: 'qwen3-30b',
      OLLAMA_API_URL: 'http://localhost:11434',
      LANGGRAPH_API_URL: 'http://localhost:2024',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    }

    expect(() => envSchema.parse(testEnv)).toThrow()
  })
})
