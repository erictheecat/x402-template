import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    process.env[key] = value;
  }
}

function handleFixtureRequest(request: IncomingMessage, response: ServerResponse): void {
  const path = request.url ?? "/";

  if (path === "/article") {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
      <html lang="en">
        <head>
          <title>Fixture Article</title>
          <meta name="description" content="Fixture description" />
          <style>.hidden { display: none; }</style>
        </head>
        <body>
          <nav>Top Navigation</nav>
          <main>
            <article>
              <h1>Fixture Heading</h1>
              <p>Main article text with useful content.</p>
              <p>Read the <a href="/docs">docs</a> and <a href="https://example.org/about">about page</a>.</p>
              <img src="/hero.png" alt="Hero" />
            </article>
          </main>
          <footer>Footer links</footer>
          <script>window.bad = true;</script>
        </body>
      </html>`);
    return;
  }

  if (path === "/plain") {
    response.statusCode = 200;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("plain text");
    return;
  }

  if (path === "/slow") {
    setTimeout(() => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<html><body><main><p>Slow content</p></main></body></html>");
    }, 5_500);
    return;
  }

  response.statusCode = 404;
  response.end("not found");
}

describe("extract route", () => {
  let fixtureServer: Server;
  let fixtureBaseUrl = "";

  beforeAll(async () => {
    fixtureServer = createServer(handleFixtureRequest);
    await new Promise<void>((resolve) => fixtureServer.listen(0, "127.0.0.1", () => resolve()));
    const address = fixtureServer.address() as AddressInfo;
    fixtureBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      fixtureServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("returns 402 without bypass header in dev bypass mode", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/extract",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "extract-gate-1",
      },
      payload: {
        url: `${fixtureBaseUrl}/article`,
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

  it("returns extracted content with dev bypass enabled", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/extract",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "extract-success-1",
        "x-dev-bypass": "true",
      },
      payload: {
        url: `${fixtureBaseUrl}/article`,
        options: {
          includeLinks: true,
          includeImages: false,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: {
        title: "Fixture Article",
        description: "Fixture description",
        language: "en",
        links: [`${fixtureBaseUrl}/docs`, "https://example.org/about"],
      },
      receipt: {
        idempotencyKey: "extract-success-1",
      },
    });

    const payload = response.json() as {
      data: { text: string; wordCount: number; request_id?: string };
    };

    expect(payload.data.text).toContain("Main article text with useful content.");
    expect(payload.data.text).not.toContain("Top Navigation");
    expect(payload.data.text).not.toContain("Footer links");
    expect(payload.data.wordCount).toBeGreaterThan(5);

    await app.close();
  });

  it("rejects invalid URLs", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/extract",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "extract-invalid-url-1",
        "x-dev-bypass": "true",
      },
      payload: {
        url: "notaurl",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_URL",
      },
    });

    await app.close();
  });

  it("rejects non-html content", async () => {
    setEnv();
    const app = await buildApp(loadConfig());

    const response = await app.inject({
      method: "POST",
      url: "/v1/extract",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "extract-plain-1",
        "x-dev-bypass": "true",
      },
      payload: {
        url: `${fixtureBaseUrl}/plain`,
      },
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({
      ok: false,
      error: {
        code: "UNSUPPORTED_CONTENT_TYPE",
      },
    });

    await app.close();
  });

  it(
    "returns a timeout error when the upstream is too slow",
    async () => {
      setEnv();
      const app = await buildApp(loadConfig());

      const response = await app.inject({
        method: "POST",
      url: "/v1/extract",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "extract-timeout-1",
        "x-dev-bypass": "true",
      },
      payload: {
        url: `${fixtureBaseUrl}/slow`,
      },
    });

      expect(response.statusCode).toBe(504);
      expect(response.json()).toMatchObject({
        ok: false,
        error: {
          code: "UPSTREAM_TIMEOUT",
        },
      });

      await app.close();
    },
    7_000,
  );
});
