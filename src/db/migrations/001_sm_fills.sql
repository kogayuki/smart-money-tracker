CREATE TABLE IF NOT EXISTS sm_fills (
  id              BIGSERIAL PRIMARY KEY,
  coin            TEXT NOT NULL,
  side            CHAR(1) NOT NULL CHECK (side IN ('B', 'A')),
  px              NUMERIC NOT NULL,
  sz              NUMERIC NOT NULL,
  notional_usd    NUMERIC NOT NULL,
  time_ms         BIGINT NOT NULL,
  hash            TEXT NOT NULL UNIQUE,
  oid             INTEGER NOT NULL,
  tid             BIGINT NOT NULL,
  crossed         BOOLEAN NOT NULL DEFAULT false,
  fee             NUMERIC NOT NULL DEFAULT 0,
  fee_token       TEXT NOT NULL DEFAULT 'USDC',
  start_position  NUMERIC,
  closed_pnl      NUMERIC,
  dir             TEXT,
  wallet_address  TEXT NOT NULL,
  wallet_label    TEXT NOT NULL,
  wallet_category TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sm_fills_coin_time ON sm_fills (coin, time_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sm_fills_wallet_time ON sm_fills (wallet_address, time_ms DESC);
CREATE INDEX IF NOT EXISTS idx_sm_fills_time ON sm_fills (time_ms DESC);
