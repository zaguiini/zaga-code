import { useApp, useInput } from 'ink'

type UseInputHandlerOptions = {
  isStreaming: boolean
  onAbort: () => void
}

export function useInputHandler({ isStreaming, onAbort }: UseInputHandlerOptions) {
  const { exit } = useApp()

  useInput((_input, key) => {
    // Ctrl+C during streaming: abort
    if (key.ctrl && _input === 'c') {
      if (isStreaming) {
        onAbort()
      } else {
        exit()
      }
    }

    // Ctrl+D during idle: exit
    if (key.ctrl && _input === 'd') {
      exit()
    }
  })
}
