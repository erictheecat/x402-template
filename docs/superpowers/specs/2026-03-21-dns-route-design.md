# POST /v1/dns Design

## Goal

Add a paid `POST /v1/dns` endpoint that returns DNS record lookups plus best-effort TLS certificate metadata using only Node built-ins.

## Approaches Considered

1. Recommended: in-repo DNS + TLS helper
   - Uses `node:dns/promises` and `node:tls`, so there is no per-call cost or new runtime dependency.
   - Keeps the route thin and lets lookup behavior be unit tested outside the HTTP layer.
   - Fits the existing route structure already used for `/v1/extract` and `/v1/sentiment`.
2. External DNS/SSL intelligence API
   - Faster to prototype.
   - Adds vendor cost and dependency risk that the ticket explicitly avoids.
3. Shelling out to `dig` or OpenSSL
   - Can expose rich diagnostics.
   - Less portable and harder to test than staying inside Node APIs.

## Chosen Design

### Route contract

`POST /v1/dns` lives under `/v1`, so the current payment gate and idempotency hook apply unchanged. The request body accepts:

- `domain`: required hostname string
- `records`: required array of record types chosen from `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`, and `SOA`

The response keeps the standard `{ ok, data, receipt }` envelope. `data` includes:

- `domain`
- `records`: object keyed by requested record type
- `ssl`: certificate summary when a TLS handshake succeeds on port 443, otherwise `null`
- `request_id`

### Lookup flow

The route delegates to a dedicated helper that:

1. normalizes and validates the hostname
2. resolves each requested record type with a 3 second timeout budget
3. maps `NXDOMAIN` and empty answers into stable machine-readable failures or empty arrays as appropriate
4. opens a TLS socket to the hostname on port 443 to read the peer certificate
5. returns issuer, validity dates, and days remaining when a certificate is present

### Pricing

This endpoint should advertise and enforce a route-specific price of `$0.003`. The catalog entry, x402 middleware route config, dev-bypass receipt amount, and route response receipt should all use the same constant.

### Error handling

The helper and route should use `AppError` for explicit failures:

- `400 INVALID_DOMAIN` for malformed hostnames or unsupported record requests
- `504 DNS_TIMEOUT` when DNS resolution or TLS probing exceeds the 3 second limit
- `404 DNS_NOT_FOUND` when the hostname does not resolve

Domains without a TLS listener should still return `200` with `ssl: null`.

### Testing

Tests should cover:

- helper validation and record-shape normalization
- helper handling of timeout, NXDOMAIN, and missing TLS
- `402` without payment
- `200` with dev bypass, including DNS records and `ssl: null` fallback
- catalog and smoke coverage for the new endpoint and `$0.003` price
