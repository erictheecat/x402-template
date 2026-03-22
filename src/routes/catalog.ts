import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { DNS_ROUTE_PRICE_USDC } from "../lib/dnsLookup.js";

export interface EndpointEntry {
  method: string;
  path: string;
  description: string;
  priceUsdc: string;
  requiredHeaders: Record<string, string>;
  body?: Record<string, string>;
  response: Record<string, string>;
}

export const PAID_ENDPOINTS: EndpointEntry[] = [
  {
    method: "POST",
    path: "/v1/echo",
    description: "Echo back any JSON payload — useful for testing x402 client integration",
    priceUsdc: "0.001",
    requiredHeaders: {
      "Idempotency-Key": "Unique key per request (UUID recommended)",
      "X-PAYMENT": "x402 payment header (auto-added by compliant x402 clients)",
    },
    body: {
      "*": "Any JSON value — echoed back verbatim",
    },
    response: {
      "data.echo": "The request body",
      "data.timestamp": "Unix ms",
      "data.request_id": "Server-assigned request ID",
      "receipt.*": "Payment receipt with chainId, txHash, payer, receiver, amount",
    },
  },
  {
    method: "POST",
    path: "/v1/extract",
    description: "Extract clean text, title, description, and links from any public URL",
    priceUsdc: "0.005",
    requiredHeaders: {
      "Idempotency-Key": "Unique key per request (UUID recommended)",
      "X-PAYMENT": "x402 payment header (auto-added by compliant x402 clients)",
    },
    body: {
      url: "string (required) — URL to fetch and extract",
      "options.includeLinks": "boolean — include outbound links in response (default: false)",
      "options.includeImages": "boolean — include image URLs in response (default: false)",
    },
    response: {
      "data.title": "Page title",
      "data.text": "Clean extracted body text",
      "data.description": "Meta description or excerpt",
      "data.links": "Array of outbound links (if requested)",
      "data.wordCount": "Approximate word count",
      "data.language": "Detected language code",
      "data.request_id": "Server-assigned request ID",
      "receipt.*": "Payment receipt with chainId, txHash, payer, receiver, amount",
    },
  },
  {
    method: "POST",
    path: "/v1/dns",
    description: "Resolve DNS records and inspect TLS certificate metadata for a hostname",
    priceUsdc: DNS_ROUTE_PRICE_USDC,
    requiredHeaders: {
      "Idempotency-Key": "Unique key per request (UUID recommended)",
      "X-PAYMENT": "x402 payment header (auto-added by compliant x402 clients)",
    },
    body: {
      domain: "string (required) — hostname to inspect",
      records: "array (required) — any of A, AAAA, CNAME, MX, TXT, NS, SOA",
    },
    response: {
      "data.domain": "Normalized hostname",
      "data.records": "Requested DNS record sets keyed by record type",
      "data.ssl": "TLS certificate summary or null when unavailable",
      "data.request_id": "Server-assigned request ID",
      "receipt.*": "Payment receipt with chainId, txHash, payer, receiver, amount",
    },
  },
  {
    method: "POST",
    path: "/v1/sentiment",
    description: "Analyze overall and sentence-level sentiment for submitted text",
    priceUsdc: "0.002",
    requiredHeaders: {
      "Idempotency-Key": "Unique key per request (UUID recommended)",
      "X-PAYMENT": "x402 payment header (auto-added by compliant x402 clients)",
    },
    body: {
      text: "string (required) — text to analyze, max 10KB",
    },
    response: {
      "data.sentiment": "Overall sentiment label: positive, neutral, or negative",
      "data.score": "Normalized overall score in the range [-1, 1]",
      "data.magnitude": "Absolute sentiment intensity in the range [0, 1]",
      "data.language": "Best-effort detected language code",
      "data.sentences": "Sentence-level sentiment summaries",
      "data.request_id": "Server-assigned request ID",
      "receipt.*": "Payment receipt with chainId, txHash, payer, receiver, amount",
    },
  },
];

export async function registerCatalogRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get(
    "/catalog",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              service: { type: "string" },
              publicBaseUrl: { type: "string" },
              chainId: { type: "number" },
              currency: { type: "string" },
              receiver: { type: "string" },
              x402: {
                type: "object",
                properties: {
                  protocol: { type: "string" },
                  facilitatorUrl: { type: "string" },
                  howToPayUrl: { type: "string" },
                },
              },
              endpoints: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    method: { type: "string" },
                    path: { type: "string" },
                    description: { type: "string" },
                    priceUsdc: { type: "string" },
                    requiredHeaders: { type: "object", additionalProperties: { type: "string" } },
                    body: { type: "object", additionalProperties: { type: "string" } },
                    response: { type: "object", additionalProperties: { type: "string" } },
                  },
                  required: ["method", "path", "description", "priceUsdc"],
                },
              },
            },
            required: ["ok", "service", "publicBaseUrl", "chainId", "currency", "receiver", "endpoints"],
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "public, max-age=60");

      return {
        ok: true,
        service: config.serviceName,
        publicBaseUrl: config.publicBaseUrl,
        chainId: config.chainId,
        currency: "USDC",
        receiver: config.receiverAddress,
        x402: {
          protocol: "x402",
          facilitatorUrl: "https://x402.org/facilitator",
          howToPayUrl: "https://x402.org/how-to-pay",
        },
        endpoints: PAID_ENDPOINTS.map((ep) => ({
          ...ep,
          url: `${config.publicBaseUrl}${ep.path}`,
        })),
      };
    },
  );
}
