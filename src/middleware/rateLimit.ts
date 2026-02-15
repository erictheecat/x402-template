import type { IncomingMessage, ServerResponse } from "node:http";

import type { FastifyReply, FastifyRequest, onRequestHookHandler } from "fastify";

import { adaptExpressLikeResponse, getIp } from "../lib/expressCompat.js";
import { errorPayload } from "../lib/errors.js";

interface CounterValue {
  windowStart: number;
  count: number;
}

class FixedWindowLimiter {
  private readonly counters = new Map<string, CounterValue>();

  consume(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const windowStart = Math.floor(now / 60_000) * 60_000;
    const existing = this.counters.get(key);

    if (!existing || existing.windowStart !== windowStart) {
      this.counters.set(key, {
        windowStart,
        count: 1,
      });
      return true;
    }

    if (existing.count >= maxPerMinute) {
      return false;
    }

    existing.count += 1;
    this.counters.set(key, existing);
    return true;
  }
}

function getIpFromFastify(request: FastifyRequest): string {
  return request.ip || "unknown";
}

export interface RateLimitController {
  globalOnRequest: onRequestHookHandler;
  unpaidAttemptMiddleware: (req: IncomingMessage, res: ServerResponse, next: (err?: Error) => void) => void;
  recordUnpaidAttempt: (request: FastifyRequest) => void;
}

export function createRateLimitController(globalPerMinute: number, unpaidPerMinute: number): RateLimitController {
  const globalLimiter = new FixedWindowLimiter();
  const unpaidLimiter = new FixedWindowLimiter();

  return {
    globalOnRequest: async (request: FastifyRequest, reply: FastifyReply) => {
      const allowed = globalLimiter.consume(getIpFromFastify(request), globalPerMinute);
      if (!allowed) {
        reply.code(429);
        reply.header("cache-control", "no-store");
        reply.send(errorPayload("RATE_LIMITED", "Global rate limit exceeded"));
      }
    },

    unpaidAttemptMiddleware: (req: IncomingMessage, res: ServerResponse, next: (err?: Error) => void) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (!path.startsWith("/v1/")) {
        next();
        return;
      }

      const allowed = unpaidLimiter.consume(getIp(req), unpaidPerMinute);
      if (!allowed) {
        const expressLike = adaptExpressLikeResponse(res);
        expressLike.status?.(429);
        expressLike.setHeader("cache-control", "no-store");
        expressLike.json?.(errorPayload("RATE_LIMITED", "Unpaid attempt rate limit exceeded"));
        return;
      }
      next();
    },

    recordUnpaidAttempt: (request: FastifyRequest) => {
      unpaidLimiter.consume(getIpFromFastify(request), unpaidPerMinute);
    },
  };
}
