import compress from "@fastify/compress";
import etag from "@fastify/etag";
import middie from "@fastify/middie";
import Fastify, { type FastifyInstance } from "fastify";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";
import { base } from "viem/chains";
import { createPublicClient, http } from "viem";

import type { AppConfig } from "./config.js";
import { AppError, sendError } from "./lib/errors.js";
import { headRequest } from "./lib/httpClient.js";
import { IdempotencyStore } from "./lib/idempotencyStore.js";
import { buildLoggerOptions } from "./logger.js";
import { createRateLimitController } from "./middleware/rateLimit.js";
import { createRequirePaymentMiddleware } from "./middleware/requirePayment.js";
import { registerRequestContext } from "./middleware/requestContext.js";
import { registerRoutes } from "./routes/index.js";
import { createX402Middleware } from "./x402/createX402Middleware.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AppError(503, "NOT_READY", message)), timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timeout));
  });
}

function registerMetrics(app: FastifyInstance, config: AppConfig): void {
  if (!config.metricsEnabled) return;

  const register = new Registry();
  collectDefaultMetrics({ register });

  const requestCounter = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "path", "status"],
    registers: [register],
  });

  app.addHook("onResponse", async (request, reply) => {
    requestCounter.inc({
      method: request.method,
      path: request.routeOptions.url ?? request.url,
      status: String(reply.statusCode),
    });
  });

  app.get("/metrics", async (request, reply) => {
    if (!config.metricsSecret || request.headers["x-metrics-secret"] !== config.metricsSecret) {
      sendError(reply, 401, "INTERNAL_ERROR", "Metrics unauthorized");
      return;
    }

    reply.header("content-type", register.contentType);
    reply.header("cache-control", "no-store");
    return reply.send(await register.metrics());
  });
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(config),
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    trustProxy: true,
    disableRequestLogging: true,
    requestIdHeader: "x-request-id",
  });

  await app.register(compress, {
    encodings: ["br", "gzip"],
    threshold: 1024,
  });
  await app.register(etag);

  await registerRequestContext(app);

  const rateLimit = createRateLimitController(config.rateLimitPerMin, config.rateLimitUnpaidPerMin);
  app.addHook("onRequest", rateLimit.globalOnRequest);

  const idempotencyStore = new IdempotencyStore();

  const rpcClient = createPublicClient({
    chain: base,
    transport: http(config.baseRpcUrl, { timeout: config.upstreamTimeoutMs }),
  });

  await app.register(middie);

  app.use(rateLimit.unpaidAttemptMiddleware);

  const x402Bundle = config.x402DevBypass ? undefined : createX402Middleware(config);
  const requirePayment = createRequirePaymentMiddleware({
    x402Middleware: x402Bundle?.middleware,
    devBypassEnabled: config.x402DevBypass,
    nodeEnv: config.nodeEnv,
    chainId: config.chainId,
    receiverAddress: config.receiverAddress,
    amount: config.priceUsdc,
  });

  app.use(requirePayment);

  await registerRoutes(app, {
    config,
    idempotencyStore,
    ready: {
      checkRpc: async () => {
        await withTimeout(rpcClient.getBlockNumber(), config.upstreamTimeoutMs, "Base RPC timeout");
      },
      checkOptionalUpstream: async () => {
        if (!config.upstreamHealthUrl) return;
        await headRequest(config.upstreamHealthUrl, config.upstreamTimeoutMs);
      },
    },
  });

  registerMetrics(app, config);

  app.addHook("onResponse", async (request, reply) => {
    if (!request.url.startsWith("/v1/")) return;

    if (reply.statusCode === 402) {
      rateLimit.recordUnpaidAttempt(request);
      return;
    }

    if (reply.statusCode < 400 && request.requestContext.paid && request.requestContext.idempotencyKey) {
      idempotencyStore.markSeen(request.requestContext.idempotencyKey);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      sendError(reply, error.statusCode, error.code, error.message);
      return;
    }

    if ((error as { code?: string }).code === "FST_ERR_VALIDATION") {
      sendError(reply, 400, "INTERNAL_ERROR", "Invalid request payload");
      return;
    }

    reply.log.error({ err: error }, "unhandled_error");
    sendError(reply, 500, "INTERNAL_ERROR", "Internal server error");
  });

  return app;
}
