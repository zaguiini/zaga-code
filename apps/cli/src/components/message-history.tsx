import React from 'react'
import { Box, Static, Text } from 'ink'
import { ToolCallLine } from './tool-call'
import type { CompletedTurn } from '@/reducer'

export function MessageHistory({ history }: { history: Array<CompletedTurn> }) {
  return (
    <Static items={history}>
      {(turn, index) => (
        <Box key={index} flexDirection="column" marginBottom={1}>
          <Text bold color="blue">
            {'>'} {turn.userMessage}
          </Text>
          {turn.tools.map((tool, i) => (
            <ToolCallLine key={i} tool={tool} />
          ))}
          <Text>{turn.assistantText}</Text>
        </Box>
      )}
    </Static>
  )
}
