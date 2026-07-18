-- PERSISTED table (ADR-0008) — NOT rebuilt. Appended each ingest (+ manual snapshots). Point-in-time
-- net worth cannot be re-derived from today's balances/valuations, so it must survive rebuilds.
-- Idempotent: CREATE ... IF NOT EXISTS so it's created once and left alone thereafter.
CREATE TABLE IF NOT EXISTS networth_snapshots (
    snapshot_date     DATE PRIMARY KEY,
    total_assets      DECIMAL(18, 2) NOT NULL,
    total_liabilities DECIMAL(18, 2) NOT NULL,
    net_worth         DECIMAL(18, 2) NOT NULL,
    breakdown         JSON,                 -- per-account / per-investment breakdown
    source            VARCHAR NOT NULL,     -- ingest | manual
    note              VARCHAR
);
