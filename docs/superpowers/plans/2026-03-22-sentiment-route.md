# Sentiment Route Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paid `POST /v1/sentiment` endpoint that returns best-effort sentiment analysis with sentence-level scoring and x402 receipt metadata.

**Architecture:** Keep the route thin and follow the existing `/v1/echo` and `/v1/extract` patterns. Put scoring and language detection in a dedicated helper so analyzer behavior can be unit tested without spinning up the HTTP stack.

**Tech Stack:** Fastify, TypeScript, Vitest

---

## Chunk 1: Test-First Contract

### Task 1: Add failing analyzer and route tests

**Files:**
- Create: `test/sentimentAnalyzer.test.ts`
- Create: `test/sentimentRoute.test.ts`
- Modify: `test/smoke.test.ts`

- [ ] **Step 1: Write failing analyzer tests**

Cover positive, negative, negated, neutral, and non-English samples plus empty and oversized validation behavior.

- [ ] **Step 2: Write failing route tests**

Cover `402`, successful `200`, empty input rejection, oversized input rejection, and receipt metadata.

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npm test -- test/sentimentAnalyzer.test.ts test/sentimentRoute.test.ts test/smoke.test.ts`
Expected: FAIL because the analyzer and route do not exist yet.

## Chunk 2: Minimal Implementation

### Task 2: Implement the analyzer and route wiring

**Files:**
- Create: `src/lib/sentiment.ts`
- Create: `src/routes/v1/sentiment.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/routes/catalog.ts`
- Modify: `src/x402/createX402Middleware.ts`

- [ ] **Step 1: Implement minimal analyzer logic**

Add text validation, sentence splitting, lexicon scoring, normalization, and best-effort language detection.

- [ ] **Step 2: Register the route**

Follow the existing `/v1` route pattern for schemas, payment-context propagation, cache headers, and receipt shape.

- [ ] **Step 3: Add payment and discovery metadata**

Register `POST /v1/sentiment` in the x402 middleware route table and in the public catalog with the route-specific price.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- test/sentimentAnalyzer.test.ts test/sentimentRoute.test.ts test/smoke.test.ts`
Expected: PASS

## Chunk 3: Documentation and Verification

### Task 3: Update docs and run full checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new endpoint**

Add the route contract and a local dev-bypass example.

- [ ] **Step 2: Run full verification**

Run:
- `npm test`
- `npm run typecheck`
- `npm run lint`

Expected: all commands exit successfully.
