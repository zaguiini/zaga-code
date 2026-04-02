import React from 'react'
import { Box, Text } from 'ink'

export function StatusBar({
  projectPath,
  tokenCount,
}: {
  projectPath: string
  tokenCount: number
}) {
  const formattedTokens =
    tokenCount >= 1000 ? `${(tokenCount / 1000).toFixed(1)}k` : String(tokenCount)

  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
      <Box flexGrow={1}>
        <Text dimColor>{projectPath}</Text>
      </Box>
      <Text dimColor>{formattedTokens} tokens</Text>
    </Box>
  )
}
