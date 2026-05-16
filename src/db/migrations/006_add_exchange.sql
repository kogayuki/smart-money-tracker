ALTER TABLE sm_fills ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'hyperliquid';
ALTER TABLE sm_fills ADD COLUMN IF NOT EXISTS tx_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_sm_fills_exchange ON sm_fills (exchange, time_ms DESC)
