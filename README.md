# x402-template

Fastify + TypeScript template for shipping x402-gated endpoints on Base mainnet (USDC only). It includes strict request ordering, idempotency guardrails, rate limits, structured logs, CI, Docker, and Railway deploy defaults.

## What This Service Does

- Exposes free operational routes: `/healthz`, `/readyz`, `/meta`, `/catalog`
- Exposes paid routes under `/v1/*`
- Gating is enforced by x402 middleware mounted through `@fastify/middie`
- Includes a golden paid endpoint: `POST /v1/echo`
- Includes a paid DNS intelligence endpoint: `POST /v1/dns`
- Includes a paid extraction endpoint: `POST /v1/extract`
- Includes a paid sentiment endpoint: `POST /v1/sentiment`

## Agent Discovery

AI agents discover this service by calling `GET /catalog` (no payment required). The response lists all paid endpoints with pricing, input schemas, and response shapes — everything an agent needs to decide what to call and how much it will cost.

**Discovery flow:**
1. Agent receives the base URL (from docs or another agent)
2. Agent calls `GET /catalog` → learns all endpoints + prices
3. Agent calls a `/v1/*` endpoint without payment → receives `402` with payment details
4. Agent pays via x402 facilitator, retries with `X-PAYMENT` header
5. Service verifies payment on-chain, returns result

## Route Contract

- `GET /healthz` -> `200 { "ok": true }`
- `GET /readyz` -> `200 { "ok": true }` or `503 { "ok": false, "error": { ... } }`
- `GET /catalog` -> machine-readable endpoint list with pricing (see Agent Discovery above)
- `GET /meta` ->
  ```json
  {
    "ok": true,
    "service": "x402-template",
    "version": "1.0.0",
    "chainId": 8453,
    "currency": "USDC",
    "price": "0.01",
    "receiver": "0x...",
    "publicBaseUrl": "https://..."
  }
  ```
- `POST /v1/echo` (paid) ->
  ```json
  {
    "ok": true,
    "data": {
      "echo": { "any": "payload" },
      "timestamp": 1739580000000,
      "request_id": "..."
    },
    "receipt": {
      "chainId": 8453,
      "currency": "USDC",
      "amount": "0.01",
      "receiver": "0x...",
      "txHash": "",
      "payer": "0x...",
      "idempotencyKey": "..."
    }
  }
  ```
- `POST /v1/extract` (paid) ->
  ```json
  {
    "ok": true,
    "data": {
      "title": "Example Page",
      "text": "Clean extracted text...",
      "description": "Meta description",
      "links": ["https://example.com/docs"],
      "wordCount": 42,
      "language": "en",
      "request_id": "..."
    },
    "receipt": {
      "chainId": 8453,
      "currency": "USDC",
      "amount": "0.01",
      "receiver": "0x...",
      "txHash": "",
      "payer": "0x...",
      "idempotencyKey": "..."
    }
  }
  ```
- `POST /v1/dns` (paid) ->
  ```json
  {
    "ok": true,
    "data": {
      "domain": "example.com",
      "records": {
        "A": ["93.184.216.34"],
        "MX": [{ "priority": 10, "exchange": "mail.example.com" }],
        "TXT": ["v=spf1 ..."],
        "NS": ["ns1.example.com"]
      },
      "ssl": {
        "issuer": "DigiCert",
        "validFrom": "2026-01-01",
        "validTo": "2027-01-01",
        "daysRemaining": 285
      },
      "request_id": "..."
    },
    "receipt": {
      "chainId": 8453,
      "currency": "USDC",
      "amount": "0.003",
      "receiver": "0x...",
      "txHash": "",
      "payer": "0x...",
      "idempotencyKey": "..."
    }
  }
  ```
- `POST /v1/sentiment` (paid) ->
  ```json
  {
    "ok": true,
    "data": {
      "sentiment": "positive",
      "score": 0.92,
      "magnitude": 0.92,
      "language": "en",
      "sentences": [
        {
          "text": "This product is absolutely fantastic and exceeded all my expectations.",
          "sentiment": "positive",
          "score": 0.92
        }
      ],
      "request_id": "..."
    },
    "receipt": {
      "chainId": 8453,
      "currency": "USDC",
      "amount": "0.002",
      "receiver": "0x...",
      "txHash": "",
      "payer": "0x...",
      "idempotencyKey": "..."
    }
  }
  ```

## Payment + Idempotency Pattern

1. Request context + basic validation
2. Global + unpaid-attempt rate limits
3. x402 gate (`/v1` middleware)
4. Idempotency preHandler (`Idempotency-Key` required)
5. Route logic

Replay behavior is strict reject (`409 IDEMPOTENCY_REPLAY`). This avoids double-charge and is machine-readable.

## Error Shape

All errors return:

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

Used codes:

- `PAYMENT_REQUIRED`
- `PAYMENT_INVALID`
- `RATE_LIMITED`
- `IDEMPOTENCY_REQUIRED`
- `IDEMPOTENCY_REPLAY`
- `INVALID_URL`
- `INVALID_TEXT`
- `INVALID_DOMAIN`
- `NOT_READY`
- `DNS_NOT_FOUND`
- `DNS_TIMEOUT`
- `TEXT_TOO_LONG`
- `UNSUPPORTED_CONTENT_TYPE`
- `UPSTREAM_TIMEOUT`
- `INTERNAL_ERROR`

## Required Environment Variables

- `CHAIN_ID=8453`
- `BASE_RPC_URL=...`
- `SELLER_PRIVATE_KEY=...`
- `USDC_CONTRACT=...`
- `RECEIVER_ADDRESS=...`
- `PRICE_USDC=0.01`
- `SERVICE_NAME=...`
- `PUBLIC_BASE_URL=...`

Optional:

- `LOG_LEVEL=info`
- `RATE_LIMIT_PER_MIN=100`
- `RATE_LIMIT_UNPAID_PER_MIN=20`
- `BODY_LIMIT_KB=10`
- `X402_DEV_BYPASS=false`

See `.env.example` for the full list.

## Local Development

```bash
npm ci
npm run dev
```

### Run Tests

```bash
npm test
```

### Run Deterministic Smoke Loop (no real money)

```bash
X402_DEV_BYPASS=true npm run smoke
```

`smoke` validates:

1. `/healthz` -> 200
2. `/meta` -> 200
3. `/v1/echo` without payment -> 402
4. `/v1/echo` with bypass header -> 200
5. `/v1/extract` without payment -> 402
6. `/v1/extract` with bypass header -> 200
7. `/v1/dns` without payment -> 402
8. `/v1/dns` with bypass header -> 200
9. `/v1/sentiment` without payment -> 402
10. `/v1/sentiment` with bypass header -> 200

## Example cURL Calls

Unpaid paid-route call (expected 402):

```bash
curl -i "$PUBLIC_BASE_URL/v1/echo" \
  -X POST \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-unpaid-1' \
  -d '{"hello":"world"}'
```

Dev bypass paid-route call (non-production only):

```bash
curl -i "$PUBLIC_BASE_URL/v1/echo" \
  -X POST \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-bypass-1' \
  -H 'x-dev-bypass: true' \
  -d '{"hello":"world"}'
```

Dev bypass extraction call (non-production only):

```bash
curl -i "$PUBLIC_BASE_URL/v1/extract" \
  -X POST \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-extract-1' \
  -H 'x-dev-bypass: true' \
  -d '{"url":"https://example.com","options":{"includeLinks":true,"includeImages":false}}'
```

Dev bypass DNS intelligence call (non-production only):

```bash
curl -i "$PUBLIC_BASE_URL/v1/dns" \
  -X POST \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-dns-1' \
  -H 'x-dev-bypass: true' \
  -d '{"domain":"example.com","records":["A","MX","TXT","NS"]}'
```

Dev bypass sentiment call (non-production only):

```bash
curl -i "$PUBLIC_BASE_URL/v1/sentiment" \
  -X POST \
  -H 'content-type: application/json' \
  -H 'idempotency-key: test-sentiment-1' \
  -H 'x-dev-bypass: true' \
  -d '{"text":"This product is absolutely fantastic and exceeded all my expectations."}'
```

Real-money verification against local service:

```bash
npm run verify:local-real
```

Real-money verification against Railway:

```bash
VERIFY_BASE_URL=https://your-service.up.railway.app npm run verify:railway
```

## Production Verification Loop (real money)

`scripts/verify-prod.ts` checks:

1. `/healthz` and `/meta` return 200
2. Unpaid `/v1/echo` returns 402
3. Paid `/v1/echo` returns 200 + receipt object
4. Receiver USDC balance increases by at least `PRICE_USDC`
5. Replay with same `Idempotency-Key` does not increase balance again

Required env for verifier:

- `BUYER_PRIVATE_KEY`
- `BASE_RPC_URL`
- `USDC_CONTRACT`
- `RECEIVER_ADDRESS`
- `PRICE_USDC`
- `CHAIN_ID=8453`
- `SELLER_PRIVATE_KEY` (recommended so verifier can fail early on seller gas issues)

### Real-Money Modes

1. `verify:local-real`:
Run local server with bypass disabled and real keys, then run:
```bash
npm run verify:local-real
```

2. `verify:railway`:
Use deployed URL:
```bash
VERIFY_BASE_URL=https://<your-service>.up.railway.app npm run verify:railway
```

### Funding Prerequisites

- Buyer wallet must hold:
- `PRICE_USDC` (or more) USDC
- Some Base ETH for gas
- Seller wallet (`SELLER_PRIVATE_KEY`) should hold some Base ETH for settlement gas

The verifier exits with explicit errors like `INSUFFICIENT_BUYER_USDC`, `INSUFFICIENT_BUYER_ETH`, `INSUFFICIENT_SELLER_ETH`, `ROUTE_MISMATCH`, and `PAYMENT_GATE_DISABLED`.

## Railway Deploy Steps

1. Create a new Railway project and connect this repo.
2. Railway will use `Dockerfile` automatically.
3. Set all required env vars from `.env.example`.
4. Set healthcheck path to `/healthz` (already in `railway.json`).
5. Deploy.
6. Run:
   ```bash
   VERIFY_BASE_URL=https://<your-service>.up.railway.app npm run verify:railway
   ```

## Verification Checklist

1. Set env vars (including production payment + receiver vars).
2. Deploy to Railway.
3. Confirm `/healthz` is green.
4. Run `npm run verify:prod -- --baseUrl=https://...`.
5. Confirm paid call succeeds and replay does not double charge.
