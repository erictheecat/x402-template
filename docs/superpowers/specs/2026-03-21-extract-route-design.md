# POST /v1/extract Design

## Goal

Add a paid `POST /v1/extract` endpoint that fetches an HTML page, extracts the main readable content, and returns a normalized payload plus the standard x402 receipt metadata.

## Approaches Considered

1. Recommended: `undici` fetch + `cheerio` heuristics
   - Fits the existing dependency guidance in [WOR-7](/WOR/issues/WOR-7)
   - Keeps the implementation small and easy to reason about
   - Lets the service strip noisy elements before building plain text, links, and metadata
2. Readability-style library
   - Usually better article extraction on messy pages
   - Adds more dependency weight and more opaque behavior than this repo currently needs
3. Raw HTML-to-text stripping only
   - Smallest implementation
   - Too weak for the task because it would keep a lot of navigation and layout noise

## Chosen Design

### Route contract

`POST /v1/extract` lives under the existing `/v1` namespace, so payment gating and idempotency remain unchanged. The request body accepts a required `url` plus optional extraction flags. The route requires `idempotency-key` in headers and returns the same top-level shape as `POST /v1/echo`: `{ ok, data, receipt }`.

### Extraction flow

The route delegates to a focused extractor helper that:

1. Validates the URL and only allows `http:` or `https:`
2. Fetches the page with `undici` and a 5 second timeout
3. Rejects non-HTML responses before parsing
4. Loads the document with `cheerio`
5. Removes obvious non-content elements such as `script`, `style`, `nav`, `footer`, and similar layout chrome
6. Chooses the best content root from `main`, `article`, `[role=main]`, then falls back to `body`
7. Builds normalized output for title, description, text, links, word count, and language

### Error handling

The route returns machine-readable errors using the existing `AppError`/`sendError` path:

- `400` for invalid URLs
- `415` for non-HTML content
- `504` with `UPSTREAM_TIMEOUT` for fetch timeouts
- `502` for upstream fetch failures that are neither input nor timeout problems

### Testing

Tests should use a local HTTP server instead of mocks so the fetch, timeout, and content-type branches exercise real behavior. The suite should cover:

- `402` without payment
- `200` with dev bypass
- extraction removes noise and returns normalized fields
- invalid URL handling
- non-HTML rejection
- upstream timeout handling
