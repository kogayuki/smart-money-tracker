CREATE TABLE IF NOT EXISTS insights (
  id              TEXT PRIMARY KEY,
  coin            TEXT NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('long','short')),
  summary         TEXT NOT NULL,
  signal_ids      TEXT[] NOT NULL DEFAULT '{}',
  pm_market_ids   TEXT[] DEFAULT '{}',
  sm_confidence   NUMERIC(4,3) NOT NULL,
  pm_sentiment    NUMERIC(4,3),
  combined_score  NUMERIC(4,3) NOT NULL,
  price_at_insight NUMERIC NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  generated_at    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insight_outcomes (
  id                BIGSERIAL PRIMARY KEY,
  insight_id        TEXT NOT NULL REFERENCES insights(id),
  check_delay_h     INTEGER NOT NULL,
  price_at_check    NUMERIC NOT NULL,
  price_change_pct  NUMERIC(8,4) NOT NULL,
  direction_correct BOOLEAN NOT NULL,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (insight_id, check_delay_h)
);
