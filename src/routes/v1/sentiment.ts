import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import { analyzeSentiment, SENTIMENT_ROUTE_PRICE_USDC } from "../../lib/sentiment.js";
import { getRawPaymentContext } from "../../middleware/requirePayment.js";

interface SentimentBody {
  text: string;
}

export async function registerSentimentRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.post<{ Body: SentimentBody }>(
    "/sentiment",
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
            text: { type: "string", minLength: 1 },
          },
          required: ["text"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  sentiment: { type: "string" },
                  score: { type: "number" },
                  magnitude: { type: "number" },
                  language: { type: "string" },
                  sentences: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string" },
                        sentiment: { type: "string" },
                        score: { type: "number" },
                      },
                      required: ["text", "sentiment", "score"],
                    },
                  },
                  request_id: { type: "string" },
                },
                required: ["sentiment", "score", "magnitude", "language", "sentences", "request_id"],
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

      const analysis = analyzeSentiment(request.body.text);

      reply.header("cache-control", "no-store");

      return {
        ok: true,
        data: {
          ...analysis,
          request_id: request.requestContext.requestId,
        },
        receipt: {
          chainId: config.chainId,
          currency: "USDC",
          amount: SENTIMENT_ROUTE_PRICE_USDC,
          receiver: config.receiverAddress,
          txHash: request.requestContext.txHash ?? "",
          payer: request.requestContext.wallet ?? "",
          idempotencyKey: request.requestContext.idempotencyKey ?? "",
        },
      };
    },
  );
}
