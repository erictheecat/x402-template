import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import { extractWebContent, type ExtractOptions } from "../../lib/webExtract.js";
import { getRawPaymentContext } from "../../middleware/requirePayment.js";

interface ExtractBody {
  url: string;
  options?: ExtractOptions;
}

export async function registerExtractRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.post<{ Body: ExtractBody }>(
    "/extract",
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
            url: { type: "string", minLength: 1 },
            options: {
              type: "object",
              properties: {
                includeLinks: { type: "boolean" },
                includeImages: { type: "boolean" },
              },
            },
          },
          required: ["url"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  text: { type: "string" },
                  description: { type: "string" },
                  links: {
                    type: "array",
                    items: { type: "string" },
                  },
                  images: {
                    type: "array",
                    items: { type: "string" },
                  },
                  wordCount: { type: "number" },
                  language: { type: "string" },
                  request_id: { type: "string" },
                },
                required: ["title", "text", "description", "links", "wordCount", "language", "request_id"],
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

      const extracted = await extractWebContent(request.body.url, request.body.options);

      reply.header("cache-control", "no-store");

      return {
        ok: true,
        data: {
          ...extracted,
          request_id: request.requestContext.requestId,
        },
        receipt: {
          chainId: config.chainId,
          currency: "USDC",
          amount: config.priceUsdc,
          receiver: config.receiverAddress,
          txHash: request.requestContext.txHash ?? "",
          payer: request.requestContext.wallet ?? "",
          idempotencyKey: request.requestContext.idempotencyKey ?? "",
        },
      };
    },
  );
}
