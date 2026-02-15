import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function applyEnv(overrides: Record<string, string>): void {
  const base: Record<string, string> = {
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

  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    process.env[key] = value;
  }
}

describe("payment gate", () => {
  it("returns 402 without bypass header in dev bypass mode", async () => {
    applyEnv({ X402_DEV_BYPASS: "true" });
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/echo",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "gate-test-1",
      },
      payload: { ping: "pong" },
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

  it("returns 200 with bypass header in dev bypass mode", async () => {
    applyEnv({ X402_DEV_BYPASS: "true" });
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/echo",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "gate-test-2",
        "x-dev-bypass": "true",
      },
      payload: { ping: "pong" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        echo: { ping: "pong" },
      },
      receipt: {
        idempotencyKey: "gate-test-2",
      },
    });

    await app.close();
  });
});
