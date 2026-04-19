import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { AGENT_PORT, startAgentServer } from '@zaga/agent/server'
import sirv from 'sirv'
import { WEB_PORT } from '@zaga/web/vite.config'

const __dirname = dirname(fileURLToPath(import.meta.url))

export { AGENT_PORT }

export { WEB_PORT }

export function startServers(webDistPath: string) {
  startAgentServer(AGENT_PORT)

  const serve = sirv(webDistPath, { single: true })
  const webServer = http.createServer(serve)
  webServer.listen(WEB_PORT)
  console.log(`Web UI server listening on :${WEB_PORT}`)
}

export function getWebDistPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'web')
  }
  return join(__dirname, '../../web/dist')
}
