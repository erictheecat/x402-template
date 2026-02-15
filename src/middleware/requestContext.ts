import { decodePaymentResponseHeader } from "@x402/core/http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getRawPaymentContext } from "./requirePayment.js";

declare module "fastify" {
  interface FastifyRequest {
    requestContext: {
      requestId: string;
      startedAt: number;
      paid: boolean;
      paidMode: "x402" | "dev_bypass" | false;
      amount?: string;
      wallet?: string;
      receiver?: string;
      txHash?: string;
      idempotencyKey?: string;
    };
  }
}

function getPaymentResponseHeader(reply: FastifyReply): string | undefined {
  const value = reply.getHeader("payment-response") ?? reply.getHeader("PAYMENT-RESPONSE");
  if (typeof value === "string") return value;
  return undefined;
}

function applyRawPaymentContext(request: FastifyRequest): void {
  const context = getRawPaymentContext(request.raw);
  if (!context) return;

  request.requestContext.paid = context.paid;
  request.requestContext.paidMode = context.paidMode;
  request.requestContext.amount = context.amount;
  request.requestContext.wallet = context.wallet;
  request.requestContext.receiver = context.receiver;
  request.requestContext.idempotencyKey = context.idempotencyKey;
}

export async function registerRequestContext(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    request.requestContext = {
      requestId: request.id,
      startedAt: Date.now(),
      paid: false,
      paidMode: false,
    };

    reply.header("x-request-id", request.requestContext.requestId);
  });

  app.addHook("preHandler", async (request) => {
    applyRawPaymentContext(request);

    const key = request.headers["idempotency-key"];
    if (typeof key === "string") {
      request.requestContext.idempotencyKey = key;
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const paymentResponseHeader = getPaymentResponseHeader(reply);
    if (paymentResponseHeader) {
      try {
        const decoded = decodePaymentResponseHeader(paymentResponseHeader);
        request.requestContext.txHash = decoded.transaction;
        if (decoded.payer) {
          request.requestContext.wallet = decoded.payer;
        }
      } catch {
        // Ignore malformed settlement metadata headers.
      }
    }

    const latencyMs = Date.now() - request.requestContext.startedAt;

    request.log.info(
      {
        request_id: request.requestContext.requestId,
        method: request.method,
        path: request.url,
        status: reply.statusCode,
        latency_ms: latencyMs,
        paid: request.requestContext.paid,
        paid_mode: request.requestContext.paidMode,
        amount: request.requestContext.amount,
        wallet: request.requestContext.wallet,
        receiver: request.requestContext.receiver,
        idempotency_key: request.requestContext.idempotencyKey,
      },
      "request_complete",
    );
  });
}
