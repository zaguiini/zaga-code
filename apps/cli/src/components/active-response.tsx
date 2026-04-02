import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { ToolCallLine } from './tool-call'
import type { AppState } from '@/reducer'

export function ActiveResponse({ activeResponse }: { activeResponse: AppState['activeResponse'] }) {
  if (!activeResponse) return null

  const hasContent = activeResponse.text.length > 0 || activeResponse.tools.length > 0

  return (
    <Box flexDirection="column">
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
