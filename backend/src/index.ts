import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/adapter.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { cleanupExpiredData, type RetentionPolicy } from './domain/retention.js';
import { logEvent } from './observability/logger.js';
import { MetricsRegistry } from './observability/metrics.js';

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

function retentionPolicyOf(config: {
  feedbackRetentionDays: number;
  assistantTraceRetentionDays: number;
  confirmationRetentionDays: number;
  rawRecordRetentionDays: number;
  auditRetentionDays: number;
  subscriptionInactiveDays: number;
}): RetentionPolicy {
  return {
    feedbackRetentionDays: config.feedbackRetentionDays,
    assistantTraceRetentionDays: config.assistantTraceRetentionDays,
    confirmationRetentionDays: config.confirmationRetentionDays,
    rawRecordRetentionDays: config.rawRecordRetentionDays,
    auditRetentionDays: config.auditRetentionDays,
    subscriptionInactiveDays: config.subscriptionInactiveDays,
  };
}

async function runRetention(db: Parameters<typeof cleanupExpiredData>[0], config: Parameters<typeof retentionPolicyOf>[0]) {
  try {
    const removed = await cleanupExpiredData(db, new Date(), retentionPolicyOf(config));
    logEvent('info', 'retention_cleanup', removed);
  } catch (error) {
    logEvent('error', 'retention_cleanup_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase({
    databaseUrl: config.databaseUrl,
    pgliteDataDir: config.pgliteDataDir,
  });

  await runMigrations(db);
  const seedResult = await seedDatabase(db, { publicWebUrl: config.publicWebUrl });
  await runRetention(db, config);
  const retentionTimer = setInterval(() => void runRetention(db, config), RETENTION_INTERVAL_MS);
  retentionTimer.unref();

  const metrics = new MetricsRegistry();
  const app = createApp({ db, config, metrics });

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  });

  logEvent('info', 'server_started', {
    port: config.port,
    host: config.host,
    driver: db.driver,
    seeded: seedResult.seeded,
    events: seedResult.eventsCount,
    admin_open: config.adminOpen,
  });

  const shutdown = async (signal: string) => {
    logEvent('info', 'server_stopping', { signal });
    clearInterval(retentionTimer);
    server.close();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logEvent('error', 'fatal_startup_error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
