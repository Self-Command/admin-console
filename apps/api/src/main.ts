import { bootstrapAdmin } from './auth/roles.js'
import {
  createRestrictedDidResolver,
  createServiceAuthVerifier,
} from './auth/service-auth.js'
import { ConfigError, loadConfig } from './config.js'
import { closeDb, createDb } from './db/index.js'
import { DirectoryIndexer } from './directory/indexer.js'
import { createPdsClient } from './directory/pds.js'
import { createPdsFirehoseSource } from './directory/source.js'
import { KyselyDirectoryStore } from './directory/store.js'
import { createLogger, redactString } from './logger.js'
import { closeServer, createAppServer } from './server.js'

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : 'invalid configuration'
    process.stderr.write(`admin-api: ${redactString(message)}\n`)
    process.exitCode = 1
    return
  }

  const logger = createLogger({
    level: config.logLevel,
    base: { service: 'admin-api' },
  })

  const db = createDb(config.databaseUrl)
  const didResolver = createRestrictedDidResolver(config)
  const verifier = createServiceAuthVerifier(config, didResolver)
  const store = new KyselyDirectoryStore(db)
  const pds = createPdsClient(config.pdsUrl, {
    timeoutMs: config.pdsTimeoutMs,
    maxBytes: config.pdsMaxBytes,
  })
  const source = createPdsFirehoseSource(config.pdsUrl, {
    reconnectMaxSeconds: config.indexer.reconnectMaxSeconds,
    maxFrameBytes: config.indexer.maxFrameBytes,
    maxBufferedBytes: config.indexer.maxBufferedBytes,
  })
  const indexer = new DirectoryIndexer({
    store,
    pds,
    source,
    logger: logger.child({ component: 'indexer' }),
    config: config.indexer,
  })

  try {
    await bootstrapAdmin(db, config, logger)
  } catch (error) {
    logger.warn('admin bootstrap check failed; continuing without it', { error })
  }

  const server = createAppServer({
    config,
    logger,
    db,
    store,
    indexer,
    verifier,
    didResolver,
    startedAt: Date.now(),
  })

  let shuttingDown = false
  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('shutting down', { reason })

    await indexer.stop()
    await closeServer(server)
    await closeDb(db).catch((error: unknown) => {
      logger.warn('database pool close failed', { error })
    })
    process.exitCode = exitCode
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
    })
  }
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error })
    void shutdown('uncaughtException', 1)
  })
  process.on('unhandledRejection', (error) => {
    logger.error('unhandled rejection', { error })
  })

  server.on('error', (error) => {
    logger.error('http server error', { error })
    void shutdown('http server error', 1)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
    server.listen(config.port, config.host)
  })

  logger.info('admin-api listening', {
    host: config.host,
    port: config.port,
    serviceDid: config.serviceDid,
    indexerEnabled: config.indexer.enabled,
  })

  void indexer.start().catch((error: unknown) => {
    logger.error('indexer stopped unexpectedly', { error })
  })
}

main().catch((error: unknown) => {
  process.stderr.write(`admin-api: fatal ${redactString(String(error))}\n`)
  process.exitCode = 1
})
