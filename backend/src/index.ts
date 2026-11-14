import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/adapter.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { logEvent } from './observability/logger.js';
import { MetricsRegistry } from './observability/metrics.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase({
    databaseUrl: config.databaseUrl,
    pgliteDataDir: config.pgliteDataDir,
  });

  await runMigrations(db);
  const seedResult = await seedDatabase(db, { publicWebUrl: config.publicWebUrl });

  const metrics = new MetricsRegistry();
  const app = createApp({ db, config, metrics });

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: '0.0.0.0',
  });

  logEvent('info', 'server_started', {
    port: config.port,
    driver: db.driver,
    seeded: seedResult.seeded,
    events: seedResult.eventsCount,
    admin_open: config.adminOpen,
  });

  const shutdown = async (signal: string) => {
    logEvent('info', 'server_stopping', { signal });
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
