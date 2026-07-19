import process from 'node:process'
import { createLogger } from '@braidhq/core'
import { loadRootEnv, startServer } from './startServer.js'

loadRootEnv()

const log = createLogger('server')

startServer({
  port: Number(process.env.BRAID_SERVER_PORT ?? 4321),
  onListen: url => log.info({ url }, `listening on ${url}`),
}).catch((error) => {
  log.error({ err: error }, 'failed to start')
  process.exit(1)
})
