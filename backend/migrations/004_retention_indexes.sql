-- P2/P3: индексы для retention и FK-проверок.
CREATE INDEX IF NOT EXISTS idx_raw_records_fetched_at ON raw_records (fetched_at);
CREATE INDEX IF NOT EXISTS idx_confirmations_expires_at ON agent_confirmations (expires_at);
CREATE INDEX IF NOT EXISTS idx_confirmations_used_at
  ON agent_confirmations (used_at)
  WHERE used_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events (venue_id);
CREATE INDEX IF NOT EXISTS idx_events_import_id ON events (import_id);
CREATE INDEX IF NOT EXISTS idx_raw_records_import_id ON raw_records (import_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_venue_id ON event_occurrences (venue_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_city ON subscriptions (city);

-- Дубликат idx_agent_traces_created_at из 002.
DROP INDEX IF EXISTS idx_traces_at;
