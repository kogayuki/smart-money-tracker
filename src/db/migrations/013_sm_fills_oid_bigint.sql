-- Hyperliquid order IDs now exceed int4 range (e.g. 511541657149),
-- causing fill-recorder insert failures for xyz:* assets.
ALTER TABLE sm_fills ALTER COLUMN oid TYPE BIGINT
