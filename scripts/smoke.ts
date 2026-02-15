import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function setSmokeEnv(): void {
  const defaults: Record<string, string> = {
    NODE_ENV: "test",
    CHAIN_ID: "8453",
    BASE_RPC_URL: "https://mainnet.base.org",
    SELLER_PRIVATE_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
    USDC_CONTRACT: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    RECEIVER_ADDRESS: "0x1111111111111111111111111111111111111111",
    PRICE_USDC: "0.01",
    SERVICE_NAME: "x402-template",
    PUBLIC_BASE_URL: "http://127.0.0.1",
    X402_DEV_BYPASS: "true",
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function assertStatus(response: Response, expected: number, message: string): Promise<void> {
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${message}. Expected ${expected}, got ${response.status}. Body: ${body}`);
  }
}

async function main(): Promise<void> {
  setSmokeEnv();
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const healthz = await fetch(`${baseUrl}/healthz`);
    await assertStatus(healthz, 200, "GET /healthz failed");

    const meta = await fetch(`${baseUrl}/meta`);
    await assertStatus(meta, 200, "GET /meta failed");
    const metaBody = (await meta.json()) as { service?: string; chainId?: number };
    if (!metaBody.service || metaBody.chainId !== 8453) {
      throw new Error(`GET /meta returned unexpected payload: ${JSON.stringify(metaBody)}`);
    }

    const unpaid = await fetch(`${baseUrl}/v1/echo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ hello: "world" }),
    });
    await assertStatus(unpaid, 402, "POST /v1/echo without payment should return 402");

    const bypassed = await fetch(`${baseUrl}/v1/echo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "x-dev-bypass": "true",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    await assertStatus(bypassed, 200, "POST /v1/echo with dev bypass should return 200");

    console.log("Smoke checks passed");
  } finally {
    await app.close();
  }
}

void main();
