import { loadConfig } from '../config.js'
import { createLogger, redactString } from '../logger.js'
import { closeDb, createDb } from './index.js'
import { migrateToLatest, migrationStatus } from './migrations.js'

async function main() {
  const command = process.argv[2] ?? 'up'
  if (command !== 'up' && command !== 'status') {
    process.stderr.write('usage: migrate-cli <up|status>\n')
    process.exitCode = 2
    return
  }

  const config = loadConfig()
  const logger = createLogger({ level: 'info' })
  const db = createDb(config.databaseUrl, { maxConnections: 2, connectionTimeoutMs: 10000 })

  try {
    if (command === 'status') {
      const status = await migrationStatus(db)
      logger.info('migration status', {
        executed: status.executed,
        pending: status.pending,
      })
      return
    }

    const outcome = await migrateToLatest(db)
    for (const name of outcome.applied) {
      logger.info('migration applied', { migration: name })
    }
    if (outcome.error) {
      logger.error('migration failed', {
        error: outcome.error,
        message: redactString(
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
        ),
      })
      process.exitCode = 1
      return
    }
    if (outcome.applied.length === 0) {
      logger.info('no pending migrations')
    } else {
      logger.info('migrations applied', { count: outcome.applied.length })
    }
  } finally {
    await closeDb(db)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `migration command failed: ${redactString(error instanceof Error ? error.message : String(error))}\n`,
  )
  process.exitCode = 1
})
