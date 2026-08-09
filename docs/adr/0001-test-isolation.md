# ADR 0001 — HTTP tests truncate; only service tests roll back

**Status:** accepted
**Date:** 2026-08-05
**Diverges from:** `docs/design.md` §9, `KICKOFF_PROMPT.md` item 9

## Context

Both source documents specify the same isolation strategy:

> Integration — Supertest against a local `micromobility_test` schema with migrations applied;
> **each test runs in a transaction that rolls back.**

That technique is sound and widely used — but not with Supertest.

Supertest boots an ephemeral HTTP server and issues a **real TCP request**. The Express handler
therefore runs:

1. on a **different connection** from the Sequelize pool than the test body holds, and
2. in a **different async context**, because the context chain is severed at the socket boundary.

A transaction opened in the test body encloses only the test body's own queries. The handler's
writes land on another connection, outside that transaction, and commit normally. The rollback
then undoes nothing, and every test leaks its rows into the next one.

`AsyncLocalStorage` / `cls-hooked` — the usual fix, and what Sequelize's `useCLS` relies on —
does not help. Node propagates async context along the async resource chain within a process;
an inbound socket connection starts a fresh chain. The server's request handler is not a
descendant of the test's context.

## Options considered

1. **Pin the pool to `max: 1`** and share one connection between test and handler so a single
   transaction wraps both. Matches the spec literally. Rejected: it serialises every query in
   the process, and deadlocks the moment a handler issues two concurrent queries — which several
   of ours do.
2. **Replace Supertest with in-process invocation** (`node-mocks-http` or calling the handler
   directly), preserving the async context. Rejected: it stops testing the HTTP layer —
   middleware ordering, cookie handling, body parsing and the error envelope are exactly what
   these tests exist to cover.
3. **Truncate and reseed between tests.** Accepted.

## Decision

- **HTTP tests** (`tests/integration/*`, via Supertest) truncate all mutable tables between
  tests and reseed reference data from a fast fixture. Opt in per file with `useCleanDatabase()`.
- **Direct service and unit tests** keep the transaction-rollback pattern, where it genuinely
  works because there is no socket in the way.

`useCleanDatabase()` is deliberately **not** a global Vitest `setupFile`. Not every integration
test wants a wiped schema: `seed.test.ts` runs the full seeder twice and compares row counts, and
a global `beforeEach` truncate would delete the data it asserts on. Opting in per file keeps that
interaction visible where it matters.

## Consequences

- Slower per test — a truncate plus a small reseed rather than a rollback. Measured at a few
  milliseconds against a laptop MySQL; acceptable.
- `fileParallelism: false` is required in `vitest.config.ts`. Test files share one schema, so
  concurrent files would truncate each other's rows mid-test.
- Reference data must be reinserted every test, so `seedReference()` is deliberately much
  smaller than the full Belagavi seed: roles, two operators and eight zones only.

## Safety

The truncate helper carries two independent guards, because this machine's MySQL instance hosts
roughly fifteen unrelated project databases:

1. **At import time** — refuses to load unless `DB_NAME_TEST` ends in `_test`.
2. **At call time** — issues `SELECT DATABASE()` and aborts unless the *live connection's* schema
   ends in `_test`.

Both exist because they can disagree: `.env` may be edited between module load and the call.
`tests/unit/truncate-guard.test.ts` asserts the guard actually fires, including for the exact
names of real databases on this machine.
