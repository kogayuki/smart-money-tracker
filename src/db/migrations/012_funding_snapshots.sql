CREATE TABLE IF NOT EXISTS funding_snapshots (
  id BIGSERIAL PRIMARY KEY,
  coin TEXT NOT NULL,
  venue TEXT NOT NULL,
  raw_rate NUMERIC NOT NULL,
  hourly_pct NUMERIC NOT NULL,
  mark_px NUMERIC,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_snapshots_coin_time ON funding_snapshots (coin, collected_at)
