# `@money/analytics/sql`

DuckDB DDL lives here. **It is intentionally empty this session** — the business/domain schema is designed
in the feature-brainstorming → schema session (ADR-0010 / D5), not guessed now.

When authored (data-layer phase), the layout is:

```
sql/
  schema.sql              # rebuildable tables + views; dropped & recreated every ingest (ADR-0002/0008)
  persist/
    0001_*.sql            # numbered SQL for the RARE table that must persist across rebuilds
                          #   (point-in-time facts that can't be re-derived, e.g. as-of net-worth)
```

Rules (see `docs/decisions/`):

- DuckDB is **rebuilt, not migrated** — a schema/logic change edits the transform and re-runs ingest.
- Manual overrides are applied at rebuild time by `ATTACH`ing the SQLite file (ADR-0004).
- `persist/` is an escape hatch used sparingly; everything else is rebuildable.
