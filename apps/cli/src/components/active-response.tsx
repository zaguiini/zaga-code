import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { ToolCallLine } from './tool-call'
import type { AppState } from '@/reducer'

type ActiveResponseProps = {
  activeResponse: AppState['activeResponse']
  userMessage: string | null
}

export function ActiveResponse({ activeResponse, userMessage }: ActiveResponseProps) {
  if (!activeResponse) return null

  const hasContent = activeResponse.text.length > 0 || activeResponse.tools.length > 0

  return (
    <Box flexDirection="column">
      {userMessage && (
        <Box marginBottom={1}>
          <Text bold color="blue">
            {'>'} {userMessage}
          </Text>
        </Box>
      )}
      {!hasContent && (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Thinking...</Text>
        </Box>
      )}
      {activeResponse.tools.map((tool, i) => (
        <ToolCallLine key={i} tool={tool} />
      ))}
      {activeResponse.text && <Text>{activeResponse.text}</Text>}
    </Box>
  )
}
