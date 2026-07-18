# `data/`

The durable, regenerable base of the analytical layer (ADR-0002).

```
data/
  raw/               immutable raw statement exports (SBI CSV/XLSX/Parquet) — the SOURCE OF TRUTH
  analytics.duckdb   rebuildable DuckDB file — derived state, safe to delete & regenerate
```

## Rules

- **`data/raw/` is the immutable source of truth.** Drop bank exports here; treat them as append-only.
  The transform is rebuildable from these files, so nothing derived is ever lost.
- **NEVER commit real financial data.** `data/raw/*` and `*.duckdb` are gitignored (only `.gitkeep` is
  tracked). Do not `git add -f` them.
- **`analytics.duckdb` is disposable.** It is rebuilt by `bun run ingest` (ADR-0003) — never migrated in
  place (ADR-0008). Deleting it loses nothing; the next ingest regenerates it from `raw/`.

## Still open

The SBI export format (exact columns/order) is unknown — a real sample is needed before the parser and
the `transactions` schema are designed (`init.md` §6). Until then this directory only holds the layout.
