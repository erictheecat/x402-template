import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import {
  DNS_ROUTE_PRICE_USDC,
  SUPPORTED_DNS_RECORD_TYPES,
  lookupDomainIntelligence,
  type DnsRecordType,
} from "../../lib/dnsLookup.js";
import { getRawPaymentContext } from "../../middleware/requirePayment.js";

interface DnsBody {
  domain: string;
  records: DnsRecordType[];
}

export async function registerDnsRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.post<{ Body: DnsBody }>(
    "/dns",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1 },
          },
          required: ["idempotency-key"],
        },
        body: {
          type: "object",
          properties: {
            domain: { type: "string", minLength: 1 },
            records: {
              type: "array",
              items: {
                type: "string",
                enum: [...SUPPORTED_DNS_RECORD_TYPES],
              },
              minItems: 1,
              uniqueItems: true,
            },
          },
          required: ["domain", "records"],
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  domain: { type: "string" },
                  records: {
                    type: "object",
                    properties: {
                      A: { type: "array", items: { type: "string" } },
                      AAAA: { type: "array", items: { type: "string" } },
                      CNAME: { type: "array", items: { type: "string" } },
                      MX: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            priority: { type: "number" },
                            exchange: { type: "string" },
                          },
                          required: ["priority", "exchange"],
                        },
                      },
                      TXT: { type: "array", items: { type: "string" } },
                      NS: { type: "array", items: { type: "string" } },
                      SOA: {
                        anyOf: [
                          {
                            type: "object",
                            properties: {
                              nsname: { type: "string" },
                              hostmaster: { type: "string" },
                              serial: { type: "number" },
                              refresh: { type: "number" },
                              retry: { type: "number" },
                              expire: { type: "number" },
                              minttl: { type: "number" },
                            },
                            required: ["nsname", "hostmaster", "serial", "refresh", "retry", "expire", "minttl"],
                          },
                          { type: "null" },
                        ],
                      },
                    },
                    additionalProperties: false,
                  },
                  ssl: {
                    anyOf: [
                      {
                        type: "object",
                        properties: {
                          issuer: { type: "string" },
                          validFrom: { type: "string" },
                          validTo: { type: "string" },
                          daysRemaining: { type: "number" },
                        },
                        required: ["issuer", "validFrom", "validTo", "daysRemaining"],
                      },
                      { type: "null" },
                    ],
                  },
                  request_id: { type: "string" },
                },
                required: ["domain", "records", "ssl", "request_id"],
              },
              receipt: {
                type: "object",
                properties: {
                  chainId: { type: "number" },
                  currency: { type: "string" },
                  amount: { type: "string" },
                  receiver: { type: "string" },
                  txHash: { type: "string" },
                  payer: { type: "string" },
                  idempotencyKey: { type: "string" },
                },
                required: [
                  "chainId",
                  "currency",
                  "amount",
                  "receiver",
                  "txHash",
                  "payer",
                  "idempotencyKey",
                ],
              },
            },
            required: ["ok", "data", "receipt"],
          },
        },
      },
    },
    async (request, reply) => {
      const rawPaymentContext = getRawPaymentContext(request.raw);
      if (rawPaymentContext) {
        request.requestContext.paid = rawPaymentContext.paid;
        request.requestContext.paidMode = rawPaymentContext.paidMode;
        request.requestContext.amount = rawPaymentContext.amount;
        request.requestContext.wallet = rawPaymentContext.wallet;
        request.requestContext.receiver = rawPaymentContext.receiver;
      }

      const result = await lookupDomainIntelligence(request.body.domain, request.body.records);

      reply.header("cache-control", "no-store");

      return {
        ok: true,
        data: {
          ...result,
          request_id: request.requestContext.requestId,
        },
        receipt: {
          chainId: config.chainId,
          currency: "USDC",
          amount: DNS_ROUTE_PRICE_USDC,
          receiver: config.receiverAddress,
          txHash: request.requestContext.txHash ?? "",
          payer: request.requestContext.wallet ?? "",
          idempotencyKey: request.requestContext.idempotencyKey ?? "",
        },
      };
    },
  );
}
