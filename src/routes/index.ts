import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { createIdempotencyPreHandler } from "../middleware/idempotency.js";
import { IdempotencyStore } from "../lib/idempotencyStore.js";
import { registerCatalogRoute } from "./catalog.js";
import { registerHealthRoutes, type ReadyDependencies } from "./health.js";
import { registerMetaRoutes } from "./meta.js";
import { registerDnsRoute } from "./v1/dns.js";
import { registerEchoRoute } from "./v1/echo.js";
import { registerExtractRoute } from "./v1/extract.js";
import { registerSentimentRoute } from "./v1/sentiment.js";

export interface RegisterRoutesDeps {
  config: AppConfig;
  ready: ReadyDependencies;
  idempotencyStore: IdempotencyStore;
}

export async function registerRoutes(app: FastifyInstance, deps: RegisterRoutesDeps): Promise<void> {
  await registerHealthRoutes(app, deps.ready);
  await registerMetaRoutes(app, deps.config);
  await registerCatalogRoute(app, deps.config);

  await app.register(
    async (v1) => {
      v1.addHook("preHandler", createIdempotencyPreHandler(deps.idempotencyStore));
      await registerDnsRoute(v1, deps.config);
      await registerEchoRoute(v1, deps.config);
      await registerExtractRoute(v1, deps.config);
      await registerSentimentRoute(v1, deps.config);
    },
    { prefix: "/v1" },
  );
}
