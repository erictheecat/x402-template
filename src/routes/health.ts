import type { FastifyInstance } from "fastify";

import { AppError, sendError } from "../lib/errors.js";

export interface ReadyDependencies {
  checkRpc: () => Promise<void>;
  checkOptionalUpstream: () => Promise<void>;
}

export async function registerHealthRoutes(app: FastifyInstance, deps: ReadyDependencies): Promise<void> {
  app.get(
    "/healthz",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");
      return { ok: true };
    },
  );

  app.get(
    "/readyz",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
            required: ["ok"],
            additionalProperties: false,
          },
          503: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
                required: ["code", "message"],
              },
            },
            required: ["ok", "error"],
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        await deps.checkRpc();
        await deps.checkOptionalUpstream();
        reply.header("cache-control", "no-store");
        return { ok: true };
      } catch (error) {
        if (error instanceof AppError) {
          sendError(reply, 503, "NOT_READY", error.message);
          return;
        }
        sendError(reply, 503, "NOT_READY", "Dependencies unavailable");
      }
    },
  );
}
