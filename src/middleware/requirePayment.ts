import type { IncomingMessage, ServerResponse } from "node:http";

import { decodePaymentSignatureHeader } from "@x402/core/http";

import { adaptExpressLikeRequest, adaptExpressLikeResponse, getHeader } from "../lib/expressCompat.js";
import { errorPayload } from "../lib/errors.js";

export const DEV_BYPASS_HEADER = "x-dev-bypass";
const PAYMENT_CONTEXT = Symbol.for("x402.payment-context");

type PaidMode = "x402" | "dev_bypass" | false;

export interface RawPaymentContext {
  paid: boolean;
  paidMode: PaidMode;
  amount?: string;
  wallet?: string;
  receiver?: string;
  chainId?: number;
  idempotencyKey?: string;
}

interface MutableRequest extends IncomingMessage {
  [PAYMENT_CONTEXT]?: RawPaymentContext;
}

export interface RequirePaymentOptions {
  x402Middleware?: (req: IncomingMessage, res: ServerResponse, next: (err?: Error) => void) => Promise<void> | void;
  devBypassEnabled: boolean;
  nodeEnv: string;
  chainId: number;
  receiverAddress: string;
  amount: string;
}

function setPaymentContext(req: IncomingMessage, context: RawPaymentContext): void {
  (req as MutableRequest)[PAYMENT_CONTEXT] = context;
}

function normalize402Json(res: ServerResponse): void {
  const expressLike = adaptExpressLikeResponse(res);
  const originalJson = expressLike.json?.bind(expressLike);

  if (!originalJson) return;

  expressLike.json = ((body: unknown) => {
    if (expressLike.statusCode === 402) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error?: unknown }).error ?? "Payment required")
          : "Payment required";

      return originalJson(errorPayload("PAYMENT_REQUIRED", message));
    }
    return originalJson(body);
  }) as typeof expressLike.json;
}

function extractPayer(payload: Record<string, unknown>): string | undefined {
  const authorization = payload.authorization as { from?: string } | undefined;
  if (authorization?.from) {
    return authorization.from;
  }

  const permit2Authorization = payload.permit2Authorization as { from?: string } | undefined;
  if (permit2Authorization?.from) {
    return permit2Authorization.from;
  }

  return undefined;
}

export function getRawPaymentContext(raw: unknown): RawPaymentContext | undefined {
  return (raw as MutableRequest)[PAYMENT_CONTEXT];
}

export function createRequirePaymentMiddleware(options: RequirePaymentOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: Error) => void): Promise<void> => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (!path.startsWith("/v1/")) {
      next();
      return;
    }

    const expressReq = adaptExpressLikeRequest(req);
    const expressRes = adaptExpressLikeResponse(res);

    const idempotencyKey = getHeader(req, "idempotency-key");

    if (options.devBypassEnabled && options.nodeEnv !== "production") {
      if (getHeader(req, DEV_BYPASS_HEADER) === "true") {
        setPaymentContext(req, {
          paid: true,
          paidMode: "dev_bypass",
          amount: options.amount,
          receiver: options.receiverAddress,
          chainId: options.chainId,
          idempotencyKey: idempotencyKey ?? undefined,
        });
        next();
        return;
      }

      expressRes.status?.(402);
      expressRes.setHeader("PAYMENT-REQUIRED", "dev-bypass");
      expressRes.setHeader("cache-control", "no-store");
      expressRes.json?.(errorPayload("PAYMENT_REQUIRED", `Provide ${DEV_BYPASS_HEADER}: true for local bypass`));
      return;
    }

    if (!options.x402Middleware) {
      expressRes.status?.(500);
      expressRes.setHeader("cache-control", "no-store");
      expressRes.json?.(errorPayload("INTERNAL_ERROR", "Payment middleware unavailable"));
      return;
    }

    normalize402Json(res);

    const paymentHeader = getHeader(req, "payment-signature") ?? getHeader(req, "x-payment");
    if (paymentHeader) {
      try {
        const decoded = decodePaymentSignatureHeader(paymentHeader);
        const payload = decoded.payload as Record<string, unknown>;
        setPaymentContext(req, {
          paid: true,
          paidMode: "x402",
          amount: decoded.accepted.amount,
          receiver: decoded.accepted.payTo,
          wallet: extractPayer(payload),
          chainId: options.chainId,
          idempotencyKey: idempotencyKey ?? undefined,
        });
      } catch {
        expressRes.status?.(402);
        expressRes.setHeader("cache-control", "no-store");
        expressRes.json?.(errorPayload("PAYMENT_INVALID", "Malformed payment signature header"));
        return;
      }
    }

    await options.x402Middleware(expressReq, expressRes, next);
  };
}
