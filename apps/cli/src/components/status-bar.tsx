import { Box, Text } from 'ink'

export function StatusBar({
  projectPath,
  tokenCount,
  maxTokens,
}: {
  projectPath: string
  tokenCount: number
  maxTokens: number
}) {
  const formattedTokens =
    tokenCount >= 1000 ? `${(tokenCount / 1000).toFixed(1)}k` : String(tokenCount)
  const percentage = maxTokens > 0 ? Math.round((tokenCount / maxTokens) * 100) : 0

  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Box flexGrow={1}>
        <Text dimColor>{projectPath}</Text>
      </Box>
      <Text dimColor>
        {formattedTokens} tokens ({percentage}%)
      </Text>
    </Box>
  )
}
