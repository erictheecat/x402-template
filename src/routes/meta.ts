import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";

export async function registerMetaRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get(
    "/meta",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              service: { type: "string" },
              version: { type: "string" },
              chainId: { type: "number" },
              currency: { type: "string" },
              price: { type: "string" },
              receiver: { type: "string" },
              publicBaseUrl: { type: "string" },
            },
            required: [
              "ok",
              "service",
              "version",
              "chainId",
              "currency",
              "price",
              "receiver",
              "publicBaseUrl",
            ],
            additionalProperties: false,
          },
        },
      },
    },
    async (_request, reply) => {
      reply.header("cache-control", "public, max-age=30");

      return {
        ok: true,
        service: config.serviceName,
        version: config.version,
        chainId: config.chainId,
        currency: "USDC",
        price: config.priceUsdc,
        receiver: config.receiverAddress,
        publicBaseUrl: config.publicBaseUrl,
      };
    },
  );
}
