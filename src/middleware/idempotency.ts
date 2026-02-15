import type { preHandlerHookHandler } from "fastify";

import { IdempotencyStore } from "../lib/idempotencyStore.js";
import { sendError } from "../lib/errors.js";

export function createIdempotencyPreHandler(store: IdempotencyStore): preHandlerHookHandler {
  return async (request, reply) => {
    const key = request.headers["idempotency-key"];

    if (!key || Array.isArray(key)) {
      sendError(reply, 400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key header is required");
      return;
    }

    request.requestContext.idempotencyKey = key;

    if (store.has(key)) {
      sendError(reply, 409, "IDEMPOTENCY_REPLAY", "Idempotency key replay detected");
      return;
    }
  };
}
