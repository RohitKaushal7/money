# 0005 — oRPC surfaces both a typed internal client and an OpenAPI/REST API

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Two kinds of consumer will call the API:

1. **This frontend** (`apps/web`) — wants end-to-end type safety with no schema drift.
2. **External apps** (to be enumerated, see `init.md` §6) — need a stable, documented, language-agnostic
   HTTP/REST surface.

## Decision

Use **oRPC** to expose **both**: a typed internal client for the frontend **and** an OpenAPI/REST surface
for external consumers, from the same procedure definitions. The Hono server (`apps/server`) mounts the
RPC handler at `/rpc` and the OpenAPI handler (with a reference UI) at `/api-reference`.

## Rationale

- One set of procedures, two transports → no duplicated contract, no drift between internal and external.
- The frontend gets inferred types via the oRPC client; external consumers get an OpenAPI document and
  REST endpoints.
- Validation lives in the procedures (Zod), so both surfaces share the same input/output schemas.

## Consequences

- Procedures should be designed as a real public API, not frontend-shaped RPC — inputs/outputs are Zod
  schemas that also become the OpenAPI contract.
- External-facing endpoints require authentication and scoping (ADR-0006); the specific external
  consumers and their endpoint shapes are an open question to resolve before hardening the surface.
- Shared response/domain types are defined once and imported by all clients (ADR-0007).
