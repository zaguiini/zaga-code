import type { RuntimeMessage, RuntimeState } from '@/runtime/state'

/**
 * Compatibility export preserved for downstream imports.
 * Runtime ownership now lives in /runtime/state.
 */
export type AgentState = RuntimeState
export type AgentMessage = RuntimeMessage
