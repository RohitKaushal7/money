# Architecture Decision Records

Each file records one decision: **Context / Decision / Rationale / Consequences**. ADRs are append-only —
supersede rather than edit once accepted.

| # | Decision |
|---|----------|
| [0001](0001-two-data-stores.md) | Two data stores split by workload (DuckDB analytical, SQLite app-state) |
| [0002](0002-raw-exports-source-of-truth.md) | Raw statement exports are the immutable source of truth |
| [0003](0003-ingest-owns-readwrite.md) | Ingest owns the sole read-write DuckDB connection; the API is read-only |
| [0004](0004-overrides-in-sqlite-via-attach.md) | Manual overrides live in SQLite, joined into the rebuild via `ATTACH` |
| [0005](0005-orpc-internal-and-openapi.md) | oRPC surfaces both a typed internal client and an OpenAPI/REST API |
| [0006](0006-layered-auth.md) | Layered auth: tailnet + Better-Auth sessions + scoped keys |
| [0007](0007-shared-types-package.md) | Shared-types package (`@money/shared`) |
| [0008](0008-migrations.md) | Migrations: Drizzle for SQLite; rebuildable transforms for DuckDB |
| [0009](0009-duckdb-node-api-isolated.md) | `@duckdb/node-api` is the client, isolated in `@money/analytics` |
| [0010](0010-single-user-and-naming.md) | Single-user for now; scaffold naming reconciliation; deferrals (D4/D5) |

See also `docs/superpowers/specs/2026-07-18-money-bootstrap-design.md` for the bootstrap session spec and
`docs/roadmap.md` for phasing.
