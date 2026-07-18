# 0006 — Auth is layered: network (tailnet) + application (sessions + scoped keys)

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

This is financial data, and the API is also meant to be consumed programmatically by external apps. That
combination needs real authentication — but the cheapest, strongest first line is simply not being
reachable from the public internet.

## Decision

Layer the defences:

- **Network layer:** the app runs behind a **tailnet**; the analytical DB is **never exposed publicly**.
- **Application layer:** **Better-Auth sessions** for the UI; **API-key / token auth (scoped)** for
  external and write endpoints.

## Rationale

- Network isolation removes the entire class of anonymous internet attackers before app auth is even
  reached.
- Sessions are the right fit for the interactive UI; scoped API keys are the right fit for programmatic
  external callers and for gating writes.
- Defence in depth: a mistake in one layer is not immediately catastrophic.

## Consequences

- Public signup is **disabled** — single owner (see ADR-0010); the owner account is provisioned
  deliberately, not via open registration.
- **`api_keys` is deferred (see ADR-0010 / D4):** the pinned `better-auth@1.6.23` ships **no apiKey
  plugin**. When external-API work starts we either adopt a Better-Auth version that ships the apiKey
  plugin (preferred — it owns the `apikey` table and verification) or hand-roll scoped keys. Until then,
  the app is session-only behind the tailnet.
- Key **scopes** map to external consumers and to write vs read access; concrete scopes are defined when
  the external consumers are known (open question, `init.md` §6).
- Do not rely on the tailnet alone for write endpoints — app-layer auth still gates writes.
