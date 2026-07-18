# 0007 — Shared-types package

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Domain concepts (categories, the coverage ratio, XIRR results, Indian financial-year math) and API
response shapes will be used by multiple consumers: this frontend, future external apps, and standalone
scripts (ingest, calculators). Defining them per-consumer guarantees drift.

## Decision

Define domain and API response types **once** in a shared package (**`@money/shared`**) and import them
everywhere (frontend, scripts, and — where useful — the API layer).

## Rationale

- Single source of truth for domain vocabulary and response contracts → no drift across clients.
- Pure TypeScript with no runtime/framework deps, so any consumer (browser, Bun script, Node) can import
  it cheaply.
- Complements ADR-0005: oRPC infers transport types, while `@money/shared` holds the framework-agnostic
  domain model and helpers that are meaningful outside the API too.

## Consequences

- `@money/shared` stays dependency-light (ideally only `zod` where schemas are shared) and side-effect free.
- **This session** the package is a skeleton seeded only with `fy.ts` (Indian FY date helpers — a fixed
  calendar fact, not a domain-design choice). The **domain types and category taxonomy are deferred** to
  the feature/schema brainstorming session (see ADR-0010 / D5), so they are designed alongside the schema
  rather than guessed now.
