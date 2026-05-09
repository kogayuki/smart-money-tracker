CREATE TABLE IF NOT EXISTS pm_markets (
  id              TEXT PRIMARY KEY,
  question        TEXT NOT NULL,
  slug            TEXT NOT NULL,
  coin            TEXT,
  outcomes        TEXT[] NOT NULL,
  outcome_prices  NUMERIC[] NOT NULL,
  volume          NUMERIC DEFAULT 0,
  liquidity       NUMERIC DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT true,
  end_date        TIMESTAMPTZ,
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  market_id       TEXT NOT NULL REFERENCES pm_markets(id),
  outcome_prices  NUMERIC[] NOT NULL,
  volume_24h      NUMERIC DEFAULT 0,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pm_snapshots_market ON pm_snapshots (market_id, fetched_at DESC);
