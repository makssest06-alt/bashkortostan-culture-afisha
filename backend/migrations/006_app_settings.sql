-- Настройки приложения, меняемые из админки без перезапуска.
-- Сейчас используется одна запись: ai_enabled (вкл/выкл ИИ-ассистента).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
