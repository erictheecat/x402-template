import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { createIdempotencyPreHandler } from "../middleware/idempotency.js";
import { IdempotencyStore } from "../lib/idempotencyStore.js";
import { registerHealthRoutes, type ReadyDependencies } from "./health.js";
import { registerMetaRoutes } from "./meta.js";
import { registerEchoRoute } from "./v1/echo.js";

export interface RegisterRoutesDeps {
  config: AppConfig;
  ready: ReadyDependencies;
  idempotencyStore: IdempotencyStore;
}

export async function registerRoutes(app: FastifyInstance, deps: RegisterRoutesDeps): Promise<void> {
  await registerHealthRoutes(app, deps.ready);
  await registerMetaRoutes(app, deps.config);

  await app.register(
    async (v1) => {
      v1.addHook("preHandler", createIdempotencyPreHandler(deps.idempotencyStore));
      await registerEchoRoute(v1, deps.config);
    },
    { prefix: "/v1" },
  );
}
