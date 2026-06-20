CREATE TABLE IF NOT EXISTS auto_trades (
  id              TEXT PRIMARY KEY,
  signal_id       TEXT NOT NULL,
  coin            TEXT NOT NULL,
  direction       TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  execution_price TEXT NOT NULL,
  quantity        TEXT NOT NULL,
  margin          TEXT NOT NULL,
  leverage        INTEGER NOT NULL,
  fee_recipient   TEXT NOT NULL,
  signal_type     TEXT NOT NULL,
  signal_confidence REAL NOT NULL,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auto_trade_errors (
  id          SERIAL PRIMARY KEY,
  signal_id   TEXT NOT NULL,
  coin        TEXT NOT NULL,
  direction   TEXT NOT NULL,
  error       TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
