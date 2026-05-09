CREATE TABLE IF NOT EXISTS signal_outcomes (
  id                BIGSERIAL PRIMARY KEY,
  signal_id         TEXT NOT NULL REFERENCES signals(id),
  check_delay_h     INTEGER NOT NULL,
  price_at_check    NUMERIC NOT NULL,
  price_change_pct  NUMERIC(8,4) NOT NULL,
  direction_correct BOOLEAN NOT NULL,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, check_delay_h)
);
