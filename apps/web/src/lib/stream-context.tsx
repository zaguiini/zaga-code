import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { ToolProgress } from '@langchain/langgraph-sdk'

export type StreamContextValue = {
  toolProgress: Array<ToolProgress>
}

const StreamContext = createContext<StreamContextValue | null>(null)

export function StreamProvider({
  children,
  toolProgress,
}: {
  children: ReactNode
  toolProgress: Array<ToolProgress>
}) {
  const value = useMemo(() => ({ toolProgress }), [toolProgress])

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>
}

export function useStreamContext(): StreamContextValue {
  const ctx = useContext(StreamContext)
  return ctx ?? { toolProgress: [] }
}
