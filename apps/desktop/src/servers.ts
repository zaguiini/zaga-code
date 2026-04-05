import http from 'node:http'
import { join } from 'node:path'
import { startAgentServer } from '@zaga/agent/server'
import sirv from 'sirv'

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
  if (process.env.ELECTRON_IS_PACKAGED) {
    // process.resourcesPath is set by Electron in packaged apps
    const resourcesPath = (process as unknown as { resourcesPath: string }).resourcesPath
    return join(resourcesPath, 'web')
  }
  return join(__dirname, '../../web/dist')
}
