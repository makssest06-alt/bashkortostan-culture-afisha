import type { Database } from '../db/adapter.js';
import { formatRfc3339Local } from './time.js';

export interface RetentionPolicy {
  feedbackRetentionDays: number;
  assistantTraceRetentionDays: number;
  confirmationRetentionDays: number;
  rawRecordRetentionDays: number;
  importRetentionDays: number;
  auditRetentionDays: number;
  subscriptionInactiveDays: number;
}

function cutoff(now: Date, days: number): string {
  return formatRfc3339Local(now.getTime() - days * 86_400_000);
}

/**
 * Чистка данных с истёкшим сроком. Вызывается на старте и по таймеру,
 * чтобы ПДн не жили вечно только потому, что никто не открыл админку.
 */
export async function cleanupExpiredData(
  db: Database,
  now: Date,
  policy: RetentionPolicy,
): Promise<Record<string, number>> {
  const nowIso = formatRfc3339Local(now);
  const feedback = await db.query('DELETE FROM feedback WHERE expires_at <= $1', [nowIso]);
  const confirmations = await db.query(
    `DELETE FROM agent_confirmations
     WHERE expires_at <= $1
        OR (used_at IS NOT NULL AND used_at <= $2)`,
    [nowIso, cutoff(now, policy.confirmationRetentionDays)],
  );
  const traces = await db.query('DELETE FROM agent_traces WHERE created_at <= $1', [
    cutoff(now, policy.assistantTraceRetentionDays),
  ]);
  const rawRecords = await db.query('DELETE FROM raw_records WHERE fetched_at <= $1', [
    cutoff(now, policy.rawRecordRetentionDays),
  ]);
  const imports = await db.query('DELETE FROM imports WHERE created_at <= $1', [
    cutoff(now, policy.importRetentionDays),
  ]);
  const audit = await db.query('DELETE FROM audit_log WHERE at <= $1', [
    cutoff(now, policy.auditRetentionDays),
  ]);
  const subscriptions = await db.query(
    'DELETE FROM subscriptions WHERE last_used_at <= $1',
    [cutoff(now, policy.subscriptionInactiveDays)],
  );

  return {
    feedback: feedback.rowCount,
    confirmations: confirmations.rowCount,
    traces: traces.rowCount,
    raw_records: rawRecords.rowCount,
    imports: imports.rowCount,
    audit_log: audit.rowCount,
    subscriptions: subscriptions.rowCount,
  };
}
