# x402-template

Fastify + TypeScript template for shipping x402-gated endpoints on Base mainnet (USDC only). It includes strict request ordering, idempotency guardrails, rate limits, structured logs, CI, Docker, and Railway deploy defaults.

## What This Service Does

- Exposes free operational routes: `/healthz`, `/readyz`, `/meta`
- Exposes paid routes under `/v1/*`
- Gating is enforced by x402 middleware mounted through `@fastify/middie`
- Includes a golden paid endpoint: `POST /v1/echo`

## Route Contract

- `GET /healthz` -> `200 { "ok": true }`
- `GET /readyz` -> `200 { "ok": true }` or `503 { "ok": false, "error": { ... } }`
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
- `NOT_READY`
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

Paid production call with x402 buyer flow:

```bash
npm run verify:prod -- --baseUrl=https://your-service.up.railway.app
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

## Railway Deploy Steps

1. Create a new Railway project and connect this repo.
2. Railway will use `Dockerfile` automatically.
3. Set all required env vars from `.env.example`.
4. Set healthcheck path to `/healthz` (already in `railway.json`).
5. Deploy.
6. Run:
   ```bash
   npm run verify:prod -- --baseUrl=https://<your-service>.up.railway.app
   ```

## Verification Checklist

1. Set env vars (including production payment + receiver vars).
2. Deploy to Railway.
3. Confirm `/healthz` is green.
4. Run `npm run verify:prod -- --baseUrl=https://...`.
5. Confirm paid call succeeds and replay does not double charge.
