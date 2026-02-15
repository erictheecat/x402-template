import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import { getRawPaymentContext } from "../../middleware/requirePayment.js";

interface EchoBody {
  [key: string]: unknown;
}

export async function registerEchoRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.post<{ Body: EchoBody }>(
    "/echo",
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
          additionalProperties: true,
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  echo: { type: "object", additionalProperties: true },
                  timestamp: { type: "number" },
                  request_id: { type: "string" },
                },
                required: ["echo", "timestamp", "request_id"],
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

      reply.header("cache-control", "no-store");

      return {
        ok: true,
        data: {
          echo: request.body,
          timestamp: Date.now(),
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
