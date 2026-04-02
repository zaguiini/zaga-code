import React from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'

type InputPromptProps = {
  isStreaming: boolean
  onSubmit: (text: string) => void
}

export function InputPrompt({ isStreaming, onSubmit }: InputPromptProps) {
  const [value, setValue] = React.useState('')

  if (isStreaming) return null

  const handleSubmit = (text: string) => {
    if (!text.trim()) return
    onSubmit(text.trim())
    setValue('')
  }

  return (
    <Box>
      <Text bold color="green">
        {'>'}{' '}
      </Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  )
}
