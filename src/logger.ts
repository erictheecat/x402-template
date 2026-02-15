import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "./config.js";

export function buildLoggerOptions(config: AppConfig): FastifyServerOptions["logger"] {
  return {
    level: config.logLevel,
    base: {
      service: config.serviceName,
      env: config.nodeEnv,
    },
    timestamp: true,
  };
}
