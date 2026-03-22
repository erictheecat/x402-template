# Extract Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paid `POST /v1/extract` endpoint that fetches HTML, extracts readable content, and returns the standard x402 response envelope.

**Architecture:** Keep the route thin and follow the existing `/v1/echo` pattern. Put fetch-and-parse behavior in a dedicated helper so route tests can cover contract shape while extraction tests exercise real upstream responses from a local server.

**Tech Stack:** Fastify, TypeScript, `undici`, `cheerio`, Vitest

---

## Chunk 1: Contract-First Tests

### Task 1: Add route-level tests for `POST /v1/extract`

**Files:**
- Create: `test/extractRoute.test.ts`
- Modify: `test/smoke.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests that verify:
- `POST /v1/extract` returns `402` without payment/bypass
- `POST /v1/extract` returns `200` with `x-dev-bypass: true`
- successful extraction returns title, description, cleaned text, links, word count, language, and receipt metadata
- invalid URLs fail with `400`
- non-HTML upstream responses fail with `415`
- slow upstream responses fail with `504` and `UPSTREAM_TIMEOUT`

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- test/extractRoute.test.ts test/smoke.test.ts`
Expected: FAIL because `/v1/extract` is not registered yet.

## Chunk 2: Route + Extractor Implementation

### Task 2: Implement the extractor helper and route registration

**Files:**
- Create: `src/lib/webExtract.ts`
- Create: `src/routes/v1/extract.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/x402/createX402Middleware.ts`
- Modify: `src/lib/errors.ts`

- [ ] **Step 1: Add the minimal extraction helper**

Implement a helper that:
- validates `http`/`https` URLs
- fetches with `undici` and a 5 second timeout
- rejects non-HTML content types
- strips obvious non-content elements
- extracts normalized text, metadata, and links

- [ ] **Step 2: Register the Fastify route**

Follow `src/routes/v1/echo.ts` for schema, payment-context propagation, cache headers, and receipt shape.

- [ ] **Step 3: Register payment metadata**

Add the new route to the x402 middleware route config so production payment gating recognizes `POST /v1/extract`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- test/extractRoute.test.ts test/smoke.test.ts`
Expected: PASS

## Chunk 3: Dependencies, Docs, and Full Verification

### Task 3: Finish dependency and documentation updates

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

- [ ] **Step 1: Add `cheerio` dependency**

Install the dependency needed by the extractor helper and capture the lockfile change.

- [ ] **Step 2: Document the new route**

Update the route contract and local verification examples in `README.md`.

- [ ] **Step 3: Run full verification**

Run:
- `npm test`
- `npm run typecheck`
- `npm run lint`

Expected: all commands exit successfully.
