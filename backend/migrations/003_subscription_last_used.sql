-- P2: активность подписки для честной очистки «неактивных 180 дней».
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

UPDATE subscriptions
SET last_used_at = created_at
WHERE last_used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_last_used
  ON subscriptions (last_used_at);
