/** Known context window sizes for OpenAI models (tokens). */
export const KNOWN_OPENAI_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-4-32k': 32_768,
  'gpt-3.5-turbo': 16_385,
  o1: 200_000,
  'o1-mini': 128_000,
  'o1-pro': 200_000,
  o3: 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,
  'chatgpt-4o-latest': 128_000,
}

export const OPENAI_API_BASE = 'https://api.openai.com/v1'
