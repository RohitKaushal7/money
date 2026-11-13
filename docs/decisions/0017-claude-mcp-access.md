# ADR-0017 — Claude gets in through an MCP endpoint inside the API

**Status:** accepted · 2026-11-13

## Context

A holdings repair was once done by SSHing into the server and writing SQLite directly. It worked only
because it was careful: raw SQL bypasses every rule the app enforces (rates are pre-tax, an explicit
monthly figure overrides rate × value, snapshots, `updated_at`). The same job should be an ordinary Claude
Code conversation that goes through the app's own validation, with a record of what changed and a way back.

## Decision

- **MCP lives inside the API server**, at `/mcp` (stateless Streamable HTTP, JSON responses). Tools are
  generated from oRPC procedures that carry `mcp` metadata (a description in owner terms, and
  `kind: read | write`); a procedure with no description is not exposed. A call runs the procedure
  in-process, so validation and middleware are exactly the UI's and no business rule is written twice.
  Excluded even if described: the `admin`, `setup`, `lock`, `import` and `tokens` routers, and
  `axio.commitImport` / `axio.removeImport` (they replace raw files and rebuild DuckDB, which cannot be undone).
- **Personal access tokens live in `control.db`**, beside users. Format `money_pat_` + 32 random bytes,
  stored only as a SHA-256 hash, shown once. Each has a scope (`read` or `read_write`), an optional expiry
  and a revocation time; they are checked on every request, so revoking is immediate, and a banned user's
  tokens stop working. A token is accepted **only** on `/mcp`; a cookie is never accepted there and a
  token never on `/rpc`.
- **Tokens bypass the screen-lock PIN.** The PIN guards an unattended browser; a token is an explicit,
  named, revocable grant the owner made while unlocked. Browser sessions are unaffected.
- **Writes are logged and undoable** in a per-user change log in `app.db` (holdings and recurring expenses
  record before/after and can be undone; undo refuses if the entity changed since). `update_holdings` is a
  preview, then apply: it checks the screenshot total (±1 per holding), refuses a stale preview and reports
  a partial apply. Each entry names the token (id and name) that made it, and the log is never pruned: it
  is the owner's audit trail, and its size is negligible next to the data it describes.
- **`query` is read-only SQL, sandboxed.** One `SELECT` per call, run in an isolated child process with
  DuckDB opened read-only, external access off, configuration locked, two threads, 500 rows and a 10 s
  limit, then hard-killed. This keeps hard rules 1 to 3 intact: the API still never opens DuckDB read-write.
  At most two such processes run at once across the server (later queries wait up to 30 s, then fail as
  busy), and a query takes the same per-user lock as ingests, since DuckDB refuses a read-write open while a
  reader holds the file.
- **Shared exchange-rate writes are admin-only.** `currency.upsert`, `setRate` and `refresh` write to
  `control.db`, which every user shares; they move to `adminProcedure`, in the app and through Claude alike.
- **OAuth is deferred.** Claude chat connectors need OAuth for a personal account (static header auth there
  is a limited beta for organisation Owners, and tokens in URLs are forbidden). Claude Code accepts a bearer
  header, so tokens serve it today. OAuth can be added later as a second way of producing the same request
  context.

## Consequences

- Coverage tracks the app: describing a new procedure is all it takes to expose it.
- Every user may create tokens, with exactly the rights they have in the app.
- A token is as powerful as its scope and nothing re-prompts for the PIN, so `read` is the right default
  for analysis sessions and a leaked `read_write` token should be revoked at once.
- Claude chat and mobile cannot use this until OAuth lands.
