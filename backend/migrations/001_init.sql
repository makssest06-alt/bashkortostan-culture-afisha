-- Идемпотентная начальная схема БД для «Афиша культуры Башкортостана» (PostgreSQL 16 / PGlite)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cities (
  slug TEXT PRIMARY KEY,
  name_ru TEXT NOT NULL,
  name_ba TEXT NOT NULL,
  name_in_ru TEXT NOT NULL,
  name_in_ba TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  city_slug TEXT NOT NULL REFERENCES cities(slug),
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_venues_city ON venues(city_slug);

CREATE TABLE IF NOT EXISTS imports (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'json')),
  file_name TEXT,
  received INTEGER NOT NULL CHECK (received >= 0),
  added INTEGER NOT NULL CHECK (added >= 0),
  updated INTEGER NOT NULL CHECK (updated >= 0),
  merged INTEGER NOT NULL DEFAULT 0 CHECK (merged >= 0),
  unchanged INTEGER NOT NULL CHECK (unchanged >= 0),
  rejected JSONB NOT NULL DEFAULT '[]'::jsonb,
  disputed JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS raw_records (
  id UUID PRIMARY KEY,
  import_id UUID REFERENCES imports(id) ON DELETE SET NULL,
  event_id UUID,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'import', 'rss', 'api', 'page')),
  source_hash TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_records_source_hash ON raw_records(source_hash);
CREATE INDEX IF NOT EXISTS idx_raw_records_event_id ON raw_records(event_id);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  legacy_code TEXT UNIQUE,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  title_ba TEXT,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other')),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  date_start TEXT,
  date_end TEXT,
  duration_min INTEGER CHECK (duration_min IS NULL OR duration_min >= 1),
  time_precision TEXT NOT NULL DEFAULT 'minute' CHECK (time_precision IN ('minute', 'date')),
  city_id TEXT NOT NULL REFERENCES cities(slug),
  city TEXT NOT NULL,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  venue TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  lon DOUBLE PRECISION CHECK (lon IS NULL OR (lon >= -180 AND lon <= 180)),
  price_min INTEGER CHECK (price_min IS NULL OR price_min >= 0),
  price_max INTEGER CHECK (price_max IS NULL OR price_max >= 0),
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  age_limit INTEGER CHECK (age_limit IS NULL OR age_limit IN (0, 6, 12, 16, 18)),
  language TEXT CHECK (language IS NULL OR language ~ '^[a-z]{2,3}$'),
  org_link TEXT,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'import', 'rss', 'api', 'page')),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  verified_at TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('published', 'draft', 'cancelled')),
  dedup_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'standalone' CHECK (kind IN ('standalone', 'performance_run', 'exhibition', 'festival')),
  popularity INTEGER NOT NULL DEFAULT 30 CHECK (popularity >= 0 AND popularity <= 100),
  organizer TEXT,
  image TEXT,
  synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  disputed BOOLEAN NOT NULL DEFAULT FALSE,
  review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  merged_into UUID,
  import_id UUID REFERENCES imports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_free_price CHECK ((NOT is_free) OR (price_min = 0 AND price_max = 0))
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_city_cat ON events(city_id, category);
CREATE INDEX IF NOT EXISTS idx_events_dedup_key ON events(dedup_key);
CREATE INDEX IF NOT EXISTS idx_events_source_hash ON events(source_hash);
CREATE INDEX IF NOT EXISTS idx_events_disputed ON events(disputed) WHERE disputed = TRUE;

CREATE TABLE IF NOT EXISTS event_occurrences (
  id TEXT PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id TEXT NOT NULL REFERENCES venues(id),
  date_start TEXT NOT NULL,
  date_end TEXT,
  time_precision TEXT NOT NULL DEFAULT 'minute' CHECK (time_precision IN ('minute', 'date')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'postponed', 'rescheduled', 'unknown')),
  status_verified BOOLEAN NOT NULL DEFAULT TRUE,
  previous_date_start TEXT,
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'sold_out', 'unknown')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_occ_event ON event_occurrences(event_id);

CREATE TABLE IF NOT EXISTS event_offers (
  id TEXT PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT,
  price INTEGER CHECK (price IS NULL OR price >= 0),
  audience TEXT CHECK (audience IS NULL OR audience IN ('adult', 'child', 'reduced')),
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_offers_event ON event_offers(event_id);

CREATE TABLE IF NOT EXISTS event_sources (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'import', 'rss', 'api', 'page')),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  verified_at TEXT,
  title TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(event_id, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_sources_event ON event_sources(event_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'web')),
  user_ref TEXT NOT NULL CHECK (user_ref ~ '^[A-Za-z0-9_-]{16,128}$'),
  city TEXT REFERENCES cities(slug),
  category TEXT CHECK (category IS NULL OR category IN ('concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other')),
  period TEXT CHECK (period IS NULL OR period IN ('today', 'tomorrow', 'weekend', 'week')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique
  ON subscriptions (channel, user_ref, COALESCE(city, ''), COALESCE(category, ''), COALESCE(period, ''));

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_ref ON subscriptions(user_ref);

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('organizer_application', 'correction', 'question')),
  event_id UUID,
  event_title TEXT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  organization TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_expires ON feedback(expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_title TEXT,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  import_id UUID,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_id);

CREATE TABLE IF NOT EXISTS agent_traces (
  id UUID PRIMARY KEY,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  engine TEXT NOT NULL,
  action TEXT NOT NULL,
  user_query_masked TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  grounding_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_usage JSONB,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_traces_at ON agent_traces(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_confirmations (
  token TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('subscribe', 'save_feedback')),
  user_ref TEXT,
  payload JSONB NOT NULL,
  summary TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
