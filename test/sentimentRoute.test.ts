import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

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
    BODY_LIMIT_KB: "20",
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    process.env[key] = value;
  }
}

describe("sentiment route", () => {
  it("returns 402 without bypass header in dev bypass mode", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/sentiment",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "sentiment-gate-1",
      },
      payload: {
        text: "This product is fantastic.",
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

  it("returns sentiment analysis with dev bypass enabled", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/sentiment",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "sentiment-success-1",
        "x-dev-bypass": "true",
      },
      payload: {
        text: "This product is absolutely fantastic and exceeded all my expectations.",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        sentiment: "positive",
        language: "en",
        sentences: [
          {
            sentiment: "positive",
          },
        ],
      },
      receipt: {
        amount: "0.002",
        idempotencyKey: "sentiment-success-1",
      },
    });

    const payload = response.json() as {
      data: { score: number; magnitude: number; request_id?: string };
    };

    expect(payload.data.score).toBeGreaterThan(0.25);
    expect(payload.data.magnitude).toBeGreaterThan(0.25);
    expect(payload.data.request_id).toBeTruthy();

    await app.close();
  });

  it("rejects empty text", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/sentiment",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "sentiment-empty-1",
        "x-dev-bypass": "true",
      },
      payload: {
        text: "   ",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_TEXT",
      },
    });

    await app.close();
  });

  it("rejects text larger than 10KB", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/sentiment",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "sentiment-large-1",
        "x-dev-bypass": "true",
      },
      payload: {
        text: "a".repeat(10_241),
      },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "TEXT_TOO_LONG",
      },
    });

    await app.close();
  });
});
