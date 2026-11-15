import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { openDatabase } from '../src/db/adapter.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDictionaries } from '../src/db/seed.js';
import type { AssistantHistoryItem, AssistantResponsePayload, ClarifyCode } from '../src/domain/assistant/nlu.js';
import type { ApiEvent } from '../src/domain/types.js';
import { MetricsRegistry } from '../src/observability/metrics.js';
import { checkCard, scoreRanking, type RelevanceRow } from './relevance-eval.js';

const root = new URL('../../evals/search/', import.meta.url);
const events = JSON.parse(readFileSync(new URL('catalog.fixture.json', root), 'utf8')) as ApiEvent[];
const rows = readFileSync(new URL('relevance.fixture.jsonl', root), 'utf8').trim().split(/\r?\n/)
  .map((line) => JSON.parse(line) as RelevanceRow);
const byId = new Map(events.map((event) => [event.id, event]));

async function seedCatalog(db: ReturnType<typeof openDatabase>) {
  await runMigrations(db);
  await seedDictionaries(db);
  await db.transaction(async (tx) => {
    for (const event of events) {
      await tx.query(`INSERT INTO venues (id, city_slug, name, address) VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO NOTHING`, [event.venue_id, event.city_id, event.venue, event.address]);
      await tx.query(`INSERT INTO events (
        id, title, normalized_title, title_ba, description, category, tags, date_start, date_end, duration_min,
        time_precision, city_id, city, venue_id, venue, address, price_min, price_max, is_free, age_limit,
        language, source_url, source_type, source_hash, verified_at, confidence, status, dedup_key,
        kind, popularity, synthetic, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`, [
        event.id, event.title, event.normalized_title, event.title_ba ?? null, event.description, event.category,
        JSON.stringify(event.tags), event.date_start, event.date_end, event.duration_min, event.time_precision,
        event.city_id, event.city, event.venue_id, event.venue, event.address, event.price_min, event.price_max,
        event.is_free, event.age_limit, event.language, event.source_url, event.source_type, event.source_hash,
        event.verified_at, event.confidence, event.status, event.dedup_key, event.kind ?? 'standalone',
        event.popularity ?? 30, event.synthetic, event.created_at, event.updated_at,
      ]);
      for (const [i, occurrence] of event.occurrences.entries()) {
        await tx.query(`INSERT INTO event_occurrences (id,event_id,venue_id,date_start,date_end,time_precision,
          status,status_verified,previous_date_start,availability,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          occurrence.id, event.id, event.venue_id, occurrence.date_start, occurrence.date_end,
          occurrence.time_precision, occurrence.status, occurrence.status_verified,
          occurrence.previous_date_start ?? null, occurrence.availability, i,
        ]);
      }
      for (const [i, offer] of (event.offers ?? []).entries()) {
        await tx.query(`INSERT INTO event_offers (id,event_id,name,price,audience,is_free,sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [`${event.id}-offer-${i}`, event.id, offer.name ?? null, offer.price, offer.audience ?? null, offer.is_free, i]);
      }
    }
  });
}

function keepsConstraints(expected: RelevanceRow['expected_hard'], actual: AssistantResponsePayload['constraints']['hard']): boolean {
  function includesObserved(expectedValue: unknown, observedValue: unknown): boolean {
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      if (!observedValue || typeof observedValue !== 'object') return false;
      return Object.entries(expectedValue).every(([key, value]) =>
        includesObserved(value, (observedValue as Record<string, unknown>)[key]));
    }
    return JSON.stringify(observedValue) === JSON.stringify(expectedValue);
  }
  return includesObserved(expected ?? {}, actual);
}

async function run(config: AppConfig, dialogues: RelevanceRow[]) {
  const db = openDatabase({ databaseUrl: 'memory://' });
  try {
    await seedCatalog(db);
    let now = new Date(dialogues[0].reference_now);
    const app = createApp({ db, config, metrics: new MetricsRegistry(), nowFn: () => now });
    const details = [];
    for (const row of dialogues) {
      now = new Date(row.reference_now);
      const history: AssistantHistoryItem[] = [];
      let previous = row.previous_query ? undefined : row.previous;
      let answering: ClarifyCode | undefined;
      const turns = [];
      const messages = row.previous_query ? [row.previous_query, row.query] : [row.query];
      for (const [index, message] of messages.entries()) {
        const start = performance.now();
        const response = await app.request('/api/v1/assistant/query', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history, previous, answering, limit: 5, user_ref: `assistant_eval_${row.id}` }),
        });
        const body = await response.json() as AssistantResponsePayload;
        if (!response.ok) throw new Error(`${row.id}: assistant HTTP ${response.status}`);
        const latencyMs = Math.round(performance.now() - start);
        const { rows: [trace] } = await db.query<{
          cost_rub: string | number | null;
          token_usage: { prompt_tokens: number; completion_tokens: number } | null;
          fallback_used: boolean;
        }>('SELECT cost_rub, token_usage, fallback_used FROM agent_traces WHERE id = $1', [body.trace_id ?? null]);
        const ids = body.results?.map((result) => result.event.id) ?? [];
        turns.push({ status: response.status, engine: body.engine ?? null, action: body.action ?? null, clarifyCode: body.clarify?.code ?? null,
          latencyMs, fallback: trace?.fallback_used ?? false, tokenUsage: trace?.token_usage ?? null,
          costRub: trace?.cost_rub == null ? null : Number(trace.cost_rub), message, answer: body.message ?? null,
          results: body.results?.map(({ event, occurrence_id }) => ({ id: event.id, occurrence_id })) ?? [],
        });
        previous = body.constraints;
        answering = body.clarify?.code;
        history.push({ role: 'user', content: message });
        if (body.message) history.push({ role: 'assistant', content: body.message.slice(0, 1000) });
        if (index === messages.length - 1) {
          const errors = (body.results ?? []).flatMap(({ event, occurrence_id }) => checkCard(
            event, occurrence_id, byId.get(event.id), row.expected_hard,
          ).map((error) => ({ id: event.id, error })));
          const costs = turns.map((turn) => turn.costRub);
          details.push({ id: row.id, turns, ...scoreRanking(ids, row.qrels), errors,
            foundInTop5: ids.some((id) => (row.qrels[id] ?? 0) >= 2),
            expectedResults: Object.values(row.qrels).some((grade) => grade >= 2),
            firstClarificationCorrect: row.expected_first_clarify === undefined
              ? null : turns[0].clarifyCode === row.expected_first_clarify,
            keptAfterFollowUp: row.previous_query ? keepsConstraints(row.expected_hard, body.constraints?.hard ?? {}) : null,
            dialogueCostRub: config.llmApiKey
              ? costs.every((cost) => cost !== null) && turns.every((turn) => turn.tokenUsage && turn.tokenUsage.prompt_tokens > 0)
                ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0) : null
              : 0,
          });
        }
      }
    }
    const turns = details.flatMap((row) => row.turns);
    const latencies = turns.map((turn) => turn.latencyMs).sort((a, b) => a - b);
    const p95Ms = latencies[Math.ceil(latencies.length * .95) - 1];
    const costs = details.flatMap((row) => row.dialogueCostRub === null ? [] : [row.dialogueCostRub]);
    const maxDialogueCostRub = costs.length ? Math.max(...costs) : null;
    const multiTurn = details.filter((row) => row.keptAfterFollowUp !== null);
    const expectedClarifications = details.filter((row) => row.firstClarificationCorrect !== null);
    const appliedViolations = details.flatMap((row) => row.errors);
    const fallbackTurns = turns.filter((turn) => turn.fallback).length;
    const modelTurnsWithUsage = turns.filter((turn) => turn.engine?.startsWith('llm:') && (turn.tokenUsage?.prompt_tokens ?? 0) > 0).length;
    return { summary: { dialogues: details.length, turns: turns.length, p95Ms,
      p95Within8s: !config.llmApiKey || modelTurnsWithUsage === turns.length ? p95Ms <= 8000 : null,
      measuredDialogueCosts: costs.length, maxDialogueCostRub,
      allDialoguesWithin5Rub: costs.length === details.length && maxDialogueCostRub !== null ? maxDialogueCostRub <= 5 : null,
      foundInTop5: details.filter((row) => row.foundInTop5).length,
      positiveDialogues: details.filter((row) => row.expectedResults).length,
      hardViolations: appliedViolations.filter((item) => !item.error.startsWith('fact:')).length,
      cardFactErrors: appliedViolations.filter((item) => item.error.startsWith('fact:')).length,
      followUps: multiTurn.length, preservedAfterFollowUp: multiTurn.filter((row) => row.keptAfterFollowUp).length,
      expectedClarifications: expectedClarifications.length,
      wrongClarifications: expectedClarifications.filter((row) => row.firstClarificationCorrect === false).length,
      modelTurnsWithUsage, fallbackTurns, textFactualAccuracy: null,
    }, details };
  } finally {
    await db.close();
  }
}

function liveConfig(): AppConfig {
  const required = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_COST_IN_RUB_PER_1K', 'LLM_COST_OUT_RUB_PER_1K'] as const;
  for (const key of required) {
    const value = process.env[key]?.trim();
    if (!value || (key.includes('COST') && !/^\d+(?:[.,]\d+)?$/.test(value))) {
      throw new Error(`Для --live задайте ${key}`);
    }
  }
  const config = loadConfig({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('LLM_'))),
    ASSISTANT_DAILY_BUDGET_RUB: process.env.ASSISTANT_DAILY_BUDGET_RUB,
  });
  const provider = new URL(config.llmBaseUrl);
  if (provider.protocol !== 'https:' && !(provider.protocol === 'http:' && provider.hostname === '127.0.0.1')) {
    throw new Error('LLM_BASE_URL должен использовать HTTPS или локальный 127.0.0.1');
  }
  return config;
}

async function fallbackProbe(config: AppConfig) {
  const provider = createServer((_, res) => res.writeHead(503).end());
  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', resolve);
  });
  try {
    const addr = provider.address();
    if (!addr || typeof addr === 'string') throw new Error('Не удалось запустить имитацию провайдера');
    const result = await run({ ...config, llmApiKey: 'fixture-key', llmBaseUrl: `http://127.0.0.1:${addr.port}` }, rows.slice(0, 1));
    const turn = result.details[0].turns[0];
    return { status: turn.status, engine: turn.engine, passed: turn.status === 200 && turn.engine === 'rules-fallback-v2'
      && turn.fallback && result.details[0].foundInTop5 && result.details[0].errors.length === 0 };
  } finally {
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--live')) throw new Error('Допустимый аргумент: --live');
  const live = args.includes('--live') ? liveConfig() : null;
  process.env.LOG_SILENT = '1';
  const config = loadConfig({});
  const rules = await run(config, rows);
  const fallback = await fallbackProbe(config);
  const model = live ? await run(live, rows) : null;
  console.log(JSON.stringify({ rules, model, fallback }, null, 2));
  if (!fallback.passed || (model && !model.summary.modelTurnsWithUsage)) {
    process.exitCode = 1;
  }
}

await main();
