import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function setEnv(): void {
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

  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] = value;
  }
}

describe("idempotency", () => {
  it("rejects replay with IDEMPOTENCY_REPLAY", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const headers = {
      "content-type": "application/json",
      "idempotency-key": "idem-1",
      "x-dev-bypass": "true",
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/echo",
      headers,
      payload: { hello: "world" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/v1/echo",
      headers,
      payload: { hello: "world" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      ok: false,
      error: {
        code: "IDEMPOTENCY_REPLAY",
      },
    });

    await app.close();
  });
});
