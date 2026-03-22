# POST /v1/sentiment Design

## Goal

Add a paid `POST /v1/sentiment` endpoint that classifies text sentiment without calling any external APIs and returns the standard x402 receipt envelope.

## Approaches Considered

1. Recommended: small in-repo AFINN-style analyzer
   - Keeps cost at zero and avoids another runtime dependency
   - Gives predictable scoring and sentence-level output that is easy to test
   - Fits the current repo style, which already keeps endpoint-specific logic in focused helper modules
2. `sentiment` npm package
   - Faster to wire in
   - Adds dependency weight for behavior simple enough to own in-repo
3. Remote NLP API
   - Higher quality in some cases
   - Violates the cost and dependency constraints in the ticket

## Chosen Design

### Route contract

`POST /v1/sentiment` lives under `/v1`, so the existing payment gate and idempotency hook apply unchanged. The request body accepts a required `text` string. The route requires `idempotency-key` and returns `{ ok, data, receipt }`.

The response `data` includes:

- `sentiment`: `positive`, `neutral`, or `negative`
- `score`: normalized overall score in the `[-1, 1]` range
- `magnitude`: normalized absolute intensity in the `[0, 1]` range
- `language`: best-effort detected language code
- `sentences`: sentence-level sentiment summaries
- `request_id`: request context id

### Analysis flow

The route delegates to a dedicated analyzer helper that:

1. Trims and validates text
2. Rejects empty input and inputs larger than 10 KB
3. Splits text into sentence-like chunks
4. Scores each sentence with a lightweight lexicon, including simple negation and intensifier handling
5. Aggregates an overall score and magnitude
6. Detects language with best-effort script and stopword heuristics

### Pricing

This endpoint should advertise and enforce a route-specific price of `$0.002`. The route, catalog entry, and x402 middleware config should all use that same fixed price instead of the service-wide default.

### Error handling

The route should use `AppError` for explicit machine-readable failures:

- `400 INVALID_TEXT` for empty or whitespace-only input
- `413 TEXT_TOO_LONG` for inputs over 10 KB
- Standard validation errors for malformed JSON shapes

### Testing

Tests should cover:

- unit tests for analyzer behavior on positive, negative, negated, neutral, and non-English inputs
- `402` without payment
- `200` with dev bypass
- `400` for empty text
- `413` for overly large text
- router registration and catalog/smoke coverage for the new endpoint
