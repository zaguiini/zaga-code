import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { ToolProgress } from '@/hooks/stream-reducer'

export type StreamContextValue = {
  toolProgress: Record<string, ToolProgress | undefined>
}

const StreamContext = createContext<StreamContextValue | null>(null)

export function StreamProvider({
  children,
  toolProgress,
}: {
  children: ReactNode
  toolProgress: Record<string, ToolProgress | undefined>
}) {
  const value = useMemo(() => ({ toolProgress }), [toolProgress])

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
}

export function useStreamContext(): StreamContextValue {
  const ctx = useContext(StreamContext)
  return ctx ?? { toolProgress: {} }
}
