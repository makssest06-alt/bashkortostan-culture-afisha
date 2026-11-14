import type { Database } from '../db/adapter.js';

/**
 * Настройки, которые модератор меняет из админки без перезапуска сервиса.
 * Значения лежат в `app_settings`; отсутствие записи означает значение по умолчанию.
 */
export const AI_ENABLED_KEY = 'ai_enabled';

export interface AiSettings {
  aiEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface SettingRow {
  value: unknown;
  updated_at: string | Date | null;
  updated_by: string | null;
}

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSettings(row: SettingRow | undefined): AiSettings {
  return {
    aiEnabled: typeof row?.value === 'boolean' ? row.value : true,
    updatedAt: toIso(row?.updated_at ?? null),
    updatedBy: row?.updated_by ?? null,
  };
}

/** По умолчанию ИИ включён: выключение — осознанное действие модератора. */
export async function readAiSettings(db: Database): Promise<AiSettings> {
  const res = await db.query<SettingRow>(
    'SELECT value, updated_at, updated_by FROM app_settings WHERE key = $1',
    [AI_ENABLED_KEY],
  );
  return toSettings(res.rows[0]);
}

export async function writeAiEnabled(db: Database, enabled: boolean, actor: string): Promise<AiSettings> {
  const res = await db.query<SettingRow>(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by
     RETURNING value, updated_at, updated_by`,
    [AI_ENABLED_KEY, JSON.stringify(enabled), actor],
  );
  return toSettings(res.rows[0]);
}
