import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { loadConfig } from './config.js';
import { openDatabase } from './db/adapter.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { detectImportFormat, runImport } from './domain/imports.js';

async function main(): Promise<void> {
  const [, , cmd, arg] = process.argv;
  const config = loadConfig();
  const db = openDatabase({
    databaseUrl: config.databaseUrl,
    pgliteDataDir: config.pgliteDataDir,
  });

  try {
    if (cmd === 'migrate') {
      const applied = await runMigrations(db);
      console.log(JSON.stringify({ ok: true, driver: db.driver, applied }));
    } else if (cmd === 'seed') {
      await runMigrations(db);
      const res = await seedDatabase(db, { publicWebUrl: config.publicWebUrl });
      console.log(JSON.stringify({ ok: true, ...res }));
    } else if (cmd === 'reset') {
      await runMigrations(db);
      const res = await seedDatabase(db, {
        publicWebUrl: config.publicWebUrl,
        forceReset: true,
      });
      console.log(JSON.stringify({ ok: true, reset: true, ...res }));
    } else if (cmd === 'import') {
      if (!arg) {
        console.error('Использование: cli.js import <path-to-csv-or-json>');
        process.exitCode = 1;
        return;
      }
      await runMigrations(db);
      await seedDatabase(db, { publicWebUrl: config.publicWebUrl });
      const text = readFileSync(arg, 'utf8');
      const fileName = basename(arg);
      const format = detectImportFormat(text, fileName);
      const report = await runImport(db, {
        format,
        bodyText: text,
        fileName,
        actor: 'cli',
      });
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error('Команды: migrate | seed | reset | import <file>');
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
