import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { startAgentServer } from '@zaga/agent/server'
import sirv from 'sirv'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const AGENT_PORT = 2024
export const WEB_PORT = 3000

export async function startServers(webDistPath: string) {
  await startAgentServer(AGENT_PORT)

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
