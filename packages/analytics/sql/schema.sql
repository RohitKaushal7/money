-- DuckDB analytical schema — REBUILDABLE derived state (ADR-0002 / ADR-0008).
-- Run by the ingest runner (scripts/ingest.ts) on every rebuild. Uses CREATE OR REPLACE so re-runs are
-- idempotent; the persisted networth_snapshots table lives in sql/persist/ and is NEVER dropped here.
--
-- Amounts: DECIMAL(18,2) INR. Dates: DATE. txn_id: deterministic hash string (ADR-0013).
-- These tables are self-contained (no ATTACH dependency); the ATTACH-joined views live in sql/views.sql,
-- created after the SQLite app DB is attached during the rebuild.

-- Category taxonomy (seeded from @money/shared CATEGORIES by the ingest).
CREATE OR REPLACE TABLE categories (
    key         VARCHAR PRIMARY KEY,
    label       VARCHAR NOT NULL,
    kind        VARCHAR NOT NULL,   -- active_income | passive_income | expense | investment | transfer
    taxable     BOOLEAN,            -- income categories only
    sort_order  INTEGER
);

-- The atomic bank-statement ledger. One row per posting; idempotent by txn_id (ADR-0013).
CREATE OR REPLACE TABLE transactions (
    txn_id          VARCHAR PRIMARY KEY,
    account_id      INTEGER NOT NULL,
    txn_date        DATE    NOT NULL,
    value_date      DATE,
    narration       VARCHAR NOT NULL,
    ref_no          VARCHAR,
    debit           DECIMAL(18, 2),
    credit          DECIMAL(18, 2),
    amount          DECIMAL(18, 2) NOT NULL,  -- signed: credit +, debit -
    balance         DECIMAL(18, 2) NOT NULL,  -- running balance from the statement
    source_file     VARCHAR NOT NULL,
    import_batch_id INTEGER NOT NULL,
    fy              VARCHAR NOT NULL,          -- e.g. FY2026-27
    month           VARCHAR NOT NULL           -- YYYY-MM
);

-- Allocation lines (ADR-0012). Default one split per txn from the rules engine; replaced by
-- transaction_manual_splits and adjusted by transaction_overrides during the rebuild.
CREATE OR REPLACE TABLE transaction_splits (
    txn_id        VARCHAR NOT NULL,
    seq           INTEGER NOT NULL,
    amount        DECIMAL(18, 2) NOT NULL,   -- signed INR
    kind          VARCHAR NOT NULL,
    category_key  VARCHAR NOT NULL,
    investment_id INTEGER,                    -- set when this split feeds an investment's XIRR ledger
    cashflow_type VARCHAR,                    -- contribution | coupon | dividend | redemption | maturity
    PRIMARY KEY (txn_id, seq)
);

-- One row per raw import file — powers the import report + undo (ADR-0013).
CREATE OR REPLACE TABLE import_batches (
    id             INTEGER PRIMARY KEY,
    source_file    VARCHAR NOT NULL,
    imported_at    TIMESTAMP NOT NULL,
    row_total      INTEGER NOT NULL,
    row_new        INTEGER NOT NULL,
    row_duplicate  INTEGER NOT NULL,
    row_conflict   INTEGER NOT NULL,
    status         VARCHAR NOT NULL
);

-- Investment cashflows for XIRR, derived from investment-linked splits (ADR-0012).
CREATE OR REPLACE TABLE investment_cashflows (
    investment_id       INTEGER NOT NULL,
    flow_date           DATE    NOT NULL,
    amount              DECIMAL(18, 2) NOT NULL,  -- signed: contribution -, payout/redemption +
    cashflow_type       VARCHAR NOT NULL,
    interest_component  DECIMAL(18, 2),           -- of a mixed payout: the passive-income part
    principal_component DECIMAL(18, 2),           -- of a mixed payout: the returned-capital part
    source_txn_id       VARCHAR
);

-- Resolved current/historical valuations: manual (SQLite) + computed (FD/PPF/bond) + NAV feed (MF).
CREATE OR REPLACE TABLE investment_valuations (
    investment_id INTEGER NOT NULL,
    as_of         DATE    NOT NULL,
    value         DECIMAL(18, 2) NOT NULL,
    source        VARCHAR NOT NULL   -- manual | compute | nav_api
);
