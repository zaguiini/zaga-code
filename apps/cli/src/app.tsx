import { useEffect } from 'react'
import { Box, useApp } from 'ink'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { Session } from '@/session'
import { useAgent } from '@/hooks/use-agent'
import { useInputHandler } from '@/hooks/use-input-handler'
import { MessageHistory } from '@/components/message-history'
import { ActiveResponse } from '@/components/active-response'
import { StatusBar } from '@/components/status-bar'
import { InputPrompt } from '@/components/input-prompt'

type AppProps = {
  agent: CompiledStateGraph<any, any, any>
  session: Session
  projectPath: string
  initialPrompt?: string
}

export function App({ agent, session, projectPath, initialPrompt }: AppProps) {
  const { exit } = useApp()
  const { state, send, abort } = useAgent({
    agent,
    threadId: session.threadId,
    projectPath,
  })
  const isStreaming = state.status === 'streaming'

  useInputHandler({ isStreaming, onAbort: abort })

  // Handle initial prompt (single-shot mode)
  useEffect(() => {
    if (initialPrompt) {
      send(initialPrompt)
    }
  }, [send, initialPrompt])

  // Exit after single-shot completes
  useEffect(() => {
    if (initialPrompt && state.status === 'idle' && state.history.length > 0) {
      exit()
    }
  }, [initialPrompt, state.status, state.history.length, exit])

  const handleSubmit = (text: string) => {
    if (text === '/exit') {
      exit()
      return
    }
    send(text)
  }

  return (
    <Box flexDirection="column">
      <MessageHistory history={state.history} />
      <ActiveResponse activeResponse={state.activeResponse} />
      <StatusBar projectPath={projectPath} tokenCount={state.tokenCount} />
      <InputPrompt isStreaming={isStreaming} onSubmit={handleSubmit} />
    </Box>
  )
}
