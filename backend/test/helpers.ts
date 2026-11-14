import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { openDatabase, type Database } from '../src/db/adapter.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { MetricsRegistry } from '../src/observability/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');
export const FIXTURES_DIR = resolve(__dirname, '../fixtures');

export const TEST_ADMIN_TOKEN = 'test-admin-token-for-vitest-1234567890';
export const FIXED_NOW = new Date('2026-11-13T10:00:00+05:00');

export interface TestContext {
  db: Database;
  app: ReturnType<typeof createApp>;
  config: AppConfig;
  metrics: MetricsRegistry;
  req: (path: string, init?: RequestInit) => Promise<Response>;
  adminReq: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

export async function createTestContext(
  overrides: Partial<AppConfig> = {},
): Promise<TestContext> {
  process.env.LOG_SILENT = '1';
  const db = openDatabase({ databaseUrl: 'memory://' });
  await runMigrations(db);
  await seedDatabase(db, {
    now: FIXED_NOW,
    publicWebUrl: 'http://localhost:3210',
  });

  const config: AppConfig = {
    port: 8000,
    host: '127.0.0.1',
    databaseUrl: 'memory://',
    pgliteDataDir: './data/pglite',
    adminToken: TEST_ADMIN_TOKEN,
    adminOpen: false,
    production: false,
    publicWebUrl: 'http://localhost:3210',
    assistantDisabled: false,
    llmApiKey: undefined,
    llmBaseUrl: 'https://api.openai.com/v1',
    llmModel: 'gpt-4o-mini',
    llmTimeoutMs: 5000,
    feedbackRetentionDays: 90,
    metricsRatePerMinute: 60,
    metricsToken: undefined,
    trustProxy: true,
    trustedProxyHops: 1,
    assistantRatePer10Min: 1000,
    assistantDailyLimit: 1000,
    assistantConfirmPer10Min: 1000,
    assistantMaxTokens: 800,
    assistantDailyBudgetRub: 100,
    assistantTraceRetentionDays: 30,
    confirmationRetentionDays: 7,
    rawRecordRetentionDays: 180,
    auditRetentionDays: 365,
    subscriptionInactiveDays: 180,
    llmCostInRubPer1k: 0.015,
    llmCostOutRubPer1k: 0.06,
    ...overrides,
  };

  const metrics = new MetricsRegistry();
  const app = createApp({
    db,
    config,
    metrics,
    nowFn: () => FIXED_NOW,
  });

  const req = (path: string, init?: RequestInit) =>
    Promise.resolve(app.request(`http://localhost${path}`, init));

  const adminReq = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${config.adminToken ?? TEST_ADMIN_TOKEN}`);
    return req(path, { ...init, headers });
  };

  return {
    db,
    app,
    config,
    metrics,
    req,
    adminReq,
    close: () => db.close(),
  };
}

export function createContractValidators() {
  const eventSchema = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'contracts/event.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  const openapiDoc = yaml.load(
    readFileSync(resolve(REPO_ROOT, 'contracts/api.openapi.yaml'), 'utf8'),
  ) as { components: { schemas: Record<string, unknown> } };

  const AjvCtor = Ajv2020 as unknown as new (opts: Record<string, unknown>) => any;
  const ajv = new AjvCtor({
    strict: false,
    allErrors: true,
    validateSchema: false,
  });
  (addFormats as unknown as (a: any) => void)(ajv);

  const EVENT_SCHEMA_ID = 'https://afisha.local/contracts/event.schema.json';
  const OPENAPI_SCHEMA_ID = 'https://afisha.local/contracts/api.openapi.yaml';

  function rewriteRefs(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(rewriteRefs);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string') {
        if (v.startsWith('#/components/')) {
          out[k] = `${OPENAPI_SCHEMA_ID}${v}`;
        } else if (v.startsWith('./event.schema.json')) {
          out[k] = `${EVENT_SCHEMA_ID}${v.slice('./event.schema.json'.length)}`;
        } else {
          out[k] = v;
        }
      } else {
        out[k] = rewriteRefs(v);
      }
    }
    return out;
  }

  ajv.addSchema({ ...eventSchema, $id: EVENT_SCHEMA_ID });
  ajv.addSchema({
    $id: OPENAPI_SCHEMA_ID,
    components: rewriteRefs(openapiDoc.components),
  });

  function assertValid(schemaName: string, data: unknown): void {
    const validate = ajv.compile({ $ref: `${OPENAPI_SCHEMA_ID}#/components/schemas/${schemaName}` });
    const ok = validate(data);
    if (!ok) {
      throw new Error(
        `Schema validation failed for ${schemaName}: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
  }

  function assertValidEvent(data: unknown): void {
    const validate = ajv.compile({ $ref: EVENT_SCHEMA_ID });
    const ok = validate(data);
    if (!ok) {
      throw new Error(
        `event.schema.json validation failed: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
  }

  return { assertValid, assertValidEvent };
}
