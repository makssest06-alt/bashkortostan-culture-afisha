import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database } from './adapter.js';

const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function runMigrations(db: Database, migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRes = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRes.rows.map((r) => r.version));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [file]);
    ran.push(file);
  }
  return ran;
}
