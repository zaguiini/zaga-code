export type RuntimeToolOutput = {
  content: string
  metadata?: Record<string, unknown>
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output

  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

function isMetadata(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isRuntimeToolOutput(value: unknown): value is RuntimeToolOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  if (typeof record.content !== 'string') {
    return false
  }

  if (record.metadata === undefined) {
    return true
  }

  return isMetadata(record.metadata)
}

export function normalizeRuntimeToolOutput(output: unknown): RuntimeToolOutput {
  if (isRuntimeToolOutput(output)) {
    return output
  }

  return { content: stringifyToolOutput(output) }
}
