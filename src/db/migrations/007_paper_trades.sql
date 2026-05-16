CREATE TABLE IF NOT EXISTS paper_trades (
  id                TEXT PRIMARY KEY,
  signal_id         TEXT NOT NULL REFERENCES signals(id),
  coin              TEXT NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('long','short')),
  entry_price       NUMERIC NOT NULL,
  exit_price        NUMERIC,
  position_size_usd NUMERIC NOT NULL,
  quantity          NUMERIC(20,10) NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('open','closed_tp','closed_sl','closed_timeout'))
                    DEFAULT 'open',
  tp_price          NUMERIC NOT NULL,
  sl_price          NUMERIC NOT NULL,
  pnl_usd           NUMERIC,
  pnl_pct           NUMERIC(8,4),
  signal_type       TEXT NOT NULL,
  signal_confidence NUMERIC(4,3) NOT NULL,
  max_close_at      TIMESTAMPTZ NOT NULL,
  opened_at         TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades (status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_paper_trades_coin ON paper_trades (coin, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_paper_trades_signal ON paper_trades (signal_id)
