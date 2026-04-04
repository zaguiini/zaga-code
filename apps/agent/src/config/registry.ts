import { createHash } from 'node:crypto'
import type { StructuredTool } from '@langchain/core/tools'

/** Process-level cache: configHash → resolved tool list. */
export const toolRegistry = new Map<string, Array<StructuredTool>>()

/** Computes a short content hash over the merged config string. */
export function computeConfigHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
