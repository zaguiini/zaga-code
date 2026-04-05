declare module '@zaga/agent/server' {
  export function startAgentServer(port: number): Promise<unknown>
}

declare module '@zaga/agent/setup' {
  interface SetupOptions {
    logLevel?: string
  }
  export function setup(opts?: SetupOptions): Promise<void>
}
