CREATE TABLE IF NOT EXISTS signals (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('confluence','new_entry','flow_shift')),
  coin             TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('long','short')),
  confidence       NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  trigger_fill_ids BIGINT[] NOT NULL DEFAULT '{}',
  wallet_labels    TEXT[] NOT NULL DEFAULT '{}',
  price_at_signal  NUMERIC NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  detected_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_coin ON signals (coin, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals (type, detected_at DESC);
