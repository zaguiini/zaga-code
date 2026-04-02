import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import type { ToolCall } from '@/reducer'

const TOOL_COLORS: Record<string, string> = {
  shell: 'yellow',
  file_read: 'cyan',
  file_write: 'cyan',
  file_edit: 'cyan',
  file_search: 'cyan',
  grep: 'magenta',
}

export function ToolCallLine({ tool }: { tool: ToolCall }) {
  const color = TOOL_COLORS[tool.name] ?? 'white'

  if (tool.status === 'running') {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text color={color}> {tool.name}</Text>
        <Text dimColor> {tool.input.slice(0, 60)}</Text>
      </Box>
    )
  }

  const preview = tool.output?.split('\n')[0]?.slice(0, 80) ?? ''
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>● {tool.name}</Text>
        <Text dimColor> {tool.input.slice(0, 60)}</Text>
      </Box>
      {preview && (
        <Box marginLeft={2}>
          <Text dimColor>→ {preview}</Text>
        </Box>
      )}
    </Box>
  )
}
