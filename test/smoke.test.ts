import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function setTestEnv(): void {
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
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

describe("smoke", () => {
  let baseUrl = "";
  let closeFn: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    setTestEnv();
    const app = await buildApp(loadConfig());
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeFn = async () => app.close();
  });

  afterAll(async () => {
    if (closeFn) {
      await closeFn();
    }
  });

  it("responds to /healthz", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("responds to /meta", async () => {
    const response = await fetch(`${baseUrl}/meta`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { service?: string; chainId?: number };
    expect(payload.service).toBe("x402-template-test");
    expect(payload.chainId).toBe(8453);
  });
});
