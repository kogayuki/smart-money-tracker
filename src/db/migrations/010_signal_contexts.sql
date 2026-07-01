CREATE TABLE IF NOT EXISTS signal_contexts (
  id              SERIAL PRIMARY KEY,
  signal_id       TEXT NOT NULL,
  coin            TEXT NOT NULL,
  direction       TEXT NOT NULL,
  funding_rate    DOUBLE PRECISION,
  open_interest   DOUBLE PRECISION,
  day_ntl_vlm     DOUBLE PRECISION,
  premium         DOUBLE PRECISION,
  oracle_px       DOUBLE PRECISION,
  mark_px         DOUBLE PRECISION,
  day_change_pct  DOUBLE PRECISION,
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_contexts_signal_id ON signal_contexts(signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_contexts_coin ON signal_contexts(coin);
