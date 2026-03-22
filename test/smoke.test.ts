import { createServer, type Server } from "node:http";
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
  let fixtureServer: Server | undefined;
  let fixtureUrl = "";

  beforeAll(async () => {
    setTestEnv();
    const app = await buildApp(loadConfig());
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeFn = async () => app.close();

    fixtureServer = createServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<html><head><title>Smoke Fixture</title></head><body><main><p>hello</p></main></body></html>");
    });

    await new Promise<void>((resolve) => fixtureServer?.listen(0, "127.0.0.1", () => resolve()));
    const fixtureAddress = fixtureServer.address() as AddressInfo;
    fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}`;
  });

  afterAll(async () => {
    if (closeFn) {
      await closeFn();
    }

    if (fixtureServer) {
      await new Promise<void>((resolve, reject) => {
        fixtureServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
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
    expect(payload.service).toBe(process.env.SERVICE_NAME);
    expect(payload.chainId).toBe(8453);
  });

  it("returns 402 for /v1/extract without payment", async () => {
    const response = await fetch(`${baseUrl}/v1/extract`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "smoke-extract-402",
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(response.status).toBe(402);
  });

  it("returns 200 for /v1/extract with dev bypass", async () => {
    const response = await fetch(`${baseUrl}/v1/extract`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "smoke-extract-200",
        "x-dev-bypass": "true",
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(response.status).toBe(200);
  });

  it("returns 402 for /v1/sentiment without payment", async () => {
    const response = await fetch(`${baseUrl}/v1/sentiment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "smoke-sentiment-402",
      },
      body: JSON.stringify({ text: "This launch looks promising." }),
    });

    expect(response.status).toBe(402);
  });

  it("returns 200 for /v1/sentiment with dev bypass", async () => {
    const response = await fetch(`${baseUrl}/v1/sentiment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "smoke-sentiment-200",
        "x-dev-bypass": "true",
      },
      body: JSON.stringify({ text: "This launch looks promising." }),
    });

    expect(response.status).toBe(200);
  });

  it("returns 402 for /v1/dns without payment", async () => {
    const response = await fetch(`${baseUrl}/v1/dns`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "smoke-dns-402",
      },
      body: JSON.stringify({ domain: "localhost", records: ["A"] }),
    });

    expect(response.status).toBe(402);
  });

  it("returns 200 for /v1/dns with dev bypass", async () => {
    const response = await fetch(`${baseUrl}/v1/dns`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "smoke-dns-200",
        "x-dev-bypass": "true",
      },
      body: JSON.stringify({ domain: "localhost", records: ["A"] }),
    });

    expect(response.status).toBe(200);
  });
});
