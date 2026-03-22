import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";

const lookupDomainIntelligence = vi.fn();

vi.mock("../src/lib/dnsLookup.js", () => ({
  DNS_ROUTE_PRICE_BASE_UNITS: "3000",
  DNS_ROUTE_PRICE_USDC: "0.003",
  SUPPORTED_DNS_RECORD_TYPES: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA"],
  lookupDomainIntelligence,
}));

function setEnv(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    NODE_ENV: "test",
    CHAIN_ID: "8453",
    BASE_RPC_URL: "https://mainnet.base.org",
    SELLER_PRIVATE_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
    USDC_CONTRACT: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    RECEIVER_ADDRESS: "0x1111111111111111111111111111111111111111",
    PRICE_USDC: "0.01",
    SERVICE_NAME: "x402-template-test",
    PUBLIC_BASE_URL: "http://127.0.0.1",
    X402_DEV_BYPASS: "true",
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    process.env[key] = value;
  }
}

async function buildTestApp() {
  const [{ buildApp }, { loadConfig }] = await Promise.all([import("../src/app.js"), import("../src/config.js")]);
  return buildApp(loadConfig());
}

describe("dns route", () => {
  beforeEach(() => {
    lookupDomainIntelligence.mockReset();
  });

  it("returns 402 without bypass header in dev bypass mode", async () => {
    setEnv();
    const app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/dns",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "dns-gate-1",
      },
      payload: {
        domain: "example.com",
        records: ["A"],
      },
    });

    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "PAYMENT_REQUIRED",
      },
    });

    await app.close();
  });

  it("returns dns intelligence with dev bypass enabled", async () => {
    setEnv();
    lookupDomainIntelligence.mockResolvedValue({
      domain: "example.com",
      records: {
        A: ["93.184.216.34"],
        MX: [{ priority: 10, exchange: "mail.example.com" }],
      },
      ssl: null,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/dns",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "dns-success-1",
        "x-dev-bypass": "true",
      },
      payload: {
        domain: "example.com",
        records: ["A", "MX"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        domain: "example.com",
        records: {
          A: ["93.184.216.34"],
          MX: [{ priority: 10, exchange: "mail.example.com" }],
        },
        ssl: null,
      },
      receipt: {
        amount: "0.003",
        idempotencyKey: "dns-success-1",
      },
    });

    expect(lookupDomainIntelligence).toHaveBeenCalledWith("example.com", ["A", "MX"]);

    const payload = response.json() as { data: { request_id?: string } };
    expect(payload.data.request_id).toBeTruthy();

    await app.close();
  });

  it("returns invalid-domain errors from the helper", async () => {
    setEnv();
    lookupDomainIntelligence.mockRejectedValue(new AppError(400, "INVALID_DOMAIN", "Domain must be valid"));

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/dns",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "dns-invalid-1",
        "x-dev-bypass": "true",
      },
      payload: {
        domain: "bad domain",
        records: ["A"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_DOMAIN",
      },
    });

    await app.close();
  });

  it("returns dns-not-found errors from the helper", async () => {
    setEnv();
    lookupDomainIntelligence.mockRejectedValue(new AppError(404, "DNS_NOT_FOUND", "Domain not found"));

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/dns",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "dns-missing-1",
        "x-dev-bypass": "true",
      },
      payload: {
        domain: "missing.example",
        records: ["A"],
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "DNS_NOT_FOUND",
      },
    });

    await app.close();
  });

  it("advertises the dns endpoint in the catalog", async () => {
    setEnv();
    const app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/catalog",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      endpoints: expect.arrayContaining([
        expect.objectContaining({
          path: "/v1/dns",
          priceUsdc: "0.003",
        }),
      ]),
    });

    await app.close();
  });
});
