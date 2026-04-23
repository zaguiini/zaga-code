import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { appRouter } from '@/server/router'
import { HarnessRuntime } from '@/runtime/harness-runtime'

export const AGENT_PORT = 2024

export function startAgentServer(port: number) {
  const runtime = new HarnessRuntime()

  const server = createHTTPServer({
    router: appRouter,
    createContext: () => ({ runtime }),
    middleware(req, res, next) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, trpc-batch-mode, trpc-accept')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      next()
    },
  })

  server.listen(port)
  console.log(`Agent tRPC server listening on :${port}`)
  return server
}
