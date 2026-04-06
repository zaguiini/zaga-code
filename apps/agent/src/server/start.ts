import { setup } from '@/setup'
import { AGENT_PORT, startAgentServer } from '@/server/index'

await setup({ logLevel: 'verbose' })
await startAgentServer(AGENT_PORT)
