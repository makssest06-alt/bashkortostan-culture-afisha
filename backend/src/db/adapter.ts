import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends QueryExecutor {
  readonly driver: 'postgres' | 'pglite';
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

class PgDatabase implements Database {
  readonly driver = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx: QueryExecutor = {
        async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
        },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PgliteDatabase implements Database {
  readonly driver = 'pglite' as const;
  private readonly db: PGlite;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(dataDir?: string) {
    if (dataDir && !dataDir.startsWith('memory://')) {
      const resolved = resolve(dataDir);
      mkdirSync(dirname(resolved), { recursive: true });
      this.db = new PGlite(resolved);
    } else {
      this.db = new PGlite();
    }
  }

  /** PGlite выполняет запросы последовательно в одном WASM-инстансе; сериализуем транзакции. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.serialize(async () => {
      const res = await this.db.query(sql, params);
      const affected = (res as { affectedRows?: number }).affectedRows;
      return { rows: res.rows as T[], rowCount: affected ?? res.rows.length };
    });
  }

  async exec(sql: string): Promise<void> {
    return this.serialize(async () => {
      await this.db.exec(sql);
    });
  }

  async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      return this.db.transaction(async (pgTx) => {
        const tx: QueryExecutor = {
          async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> {
            const res = await pgTx.query(sql, params);
            const affected = (res as { affectedRows?: number }).affectedRows;
            return { rows: res.rows as R[], rowCount: affected ?? res.rows.length };
          },
        };
        return fn(tx);
      });
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.serialize(() => this.db.close());
  }
}

export function openDatabase(options: { databaseUrl?: string; pgliteDataDir?: string } = {}): Database {
  const url = (options.databaseUrl ?? '').trim();
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return new PgDatabase(url);
  }
  if (url === 'memory://' || url === ':memory:') {
    return new PgliteDatabase('memory://');
  }
  if (url.startsWith('pglite://')) {
    const path = url.slice('pglite://'.length) || options.pgliteDataDir || './data/pglite';
    return new PgliteDatabase(path);
  }
  return new PgliteDatabase(options.pgliteDataDir ?? './data/pglite');
}
