ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS exchange TEXT;

UPDATE auto_trades
SET exchange = CASE WHEN tx_hash LIKE 'grvt%' THEN 'grvt' ELSE 'hyperliquid' END
WHERE exchange IS NULL;
