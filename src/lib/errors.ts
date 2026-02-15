import type { FastifyReply } from "fastify";

export type ErrorCode =
  | "PAYMENT_REQUIRED"
  | "PAYMENT_INVALID"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_REQUIRED"
  | "IDEMPOTENCY_REPLAY"
  | "NOT_READY"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
  };
}

export class AppError extends Error {
  statusCode: number;
  code: ErrorCode;

  constructor(statusCode: number, code: ErrorCode, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorPayload(code: ErrorCode, message: string): ErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

export function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  reply.code(statusCode);
  reply.header("cache-control", "no-store");
  return reply.send(errorPayload(code, message));
}
