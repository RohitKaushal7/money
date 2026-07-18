# 0013 — Idempotent ingest via deterministic txn_id; UI import routes through the ingest runner

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Statement exports overlap (import Apr–Jul, then accidentally paste Jun–Aug) and get re-run. Re-imports
must not create duplicates or wipe manual work. Separately, the owner wants to import by **pasting CSV**
into the web UI — but the API opens DuckDB read-only (ADR-0003) and DuckDB is single-writer, so the UI
must not write DuckDB directly.

## Decision

- **Deterministic identity:** `txn_id = hash(account_id, txn_date, signed_amount, running_balance)`.
  Running balance is cumulative, making the tuple a naturally-unique fingerprint per posting. **Narration
  is excluded** from the key so a re-worded description doesn't forge a phantom row. Ingest **idempotent-
  upserts** by `txn_id`; overrides and manual splits (keyed on `txn_id`) survive re-import.
- **UI import path:** paste → API validates and **persists the CSV as an immutable raw file** under
  `data/raw/` (ADR-0002) → invokes the **ingest runner** (`scripts/ingest.ts`, the sole RW owner,
  ADR-0003) → idempotent upsert → rebuild → returns an import report. A **dry-run** preview returns
  `{new, duplicate, conflict}` before commit. The API never writes DuckDB.
- **Batches & undo:** each raw file is one `import_batches` row; undo = delete the raw file + rebuild
  (DuckDB is rebuildable derived state).

## Rationale

- A content-derived id makes ingestion idempotent without a separate reconciliation store; overlaps
  collapse for free.
- Excluding narration from the key trades a negligible collision risk (balance already disambiguates) for
  robustness against issuer re-wording.
- Routing the paste through the raw-file + ingest-runner pipeline preserves every invariant (read-only
  API, single writer, immutable raw source) while still giving the paste-in UX.

## Consequences

- The CSV parser must handle SBI's quoted, **multi-line `Details`** field (embedded newlines) — not naive
  line-splitting.
- During a write the API's reads use short-lived read-only connections (or a brief coordinated lock);
  acceptable for single-user self-hosted.
- The dry-run preview is a first-class ingest mode, not an afterthought.
- If the identity scheme ever changes, `txn_id`s change and overrides would need remapping — treat the
  key as stable.
