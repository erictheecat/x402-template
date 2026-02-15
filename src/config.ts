const REQUIRED_CHAIN_ID = 8453;
const USDC_DECIMALS = 6;

export interface AppConfig {
  nodeEnv: string;
  port: number;
  logLevel: string;
  serviceName: string;
  version: string;
  chainId: number;
  baseRpcUrl: string;
  sellerPrivateKey: `0x${string}`;
  usdcContract: `0x${string}`;
  receiverAddress: `0x${string}`;
  priceUsdc: string;
  priceBaseUnits: string;
  publicBaseUrl: string;
  rateLimitPerMin: number;
  rateLimitUnpaidPerMin: number;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  upstreamTimeoutMs: number;
  upstreamHealthUrl?: string;
  x402DevBypass: boolean;
  metricsEnabled: boolean;
  metricsSecret?: string;
}

interface EnvLike {
  [key: string]: string | undefined;
}

function requireEnv(env: EnvLike, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function parseIntEnv(env: EnvLike, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${key}: ${raw}`);
  }
  return parsed;
}

function parseBoolEnv(env: EnvLike, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (!raw) return fallback;
  return raw.toLowerCase() === "true";
}

function parseHexAddress(value: string, key: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid address for ${key}: ${value}`);
  }
  return value as `0x${string}`;
}

function parsePrivateKey(value: string, key: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`Invalid private key for ${key}`);
  }
  return value as `0x${string}`;
}

function normalizeUsdcPrice(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid PRICE_USDC value: ${value}`);
  }
  const trimmed = value.replace(/^0+(?=\d)/, "") || "0";
  if (Number(trimmed) <= 0) {
    throw new Error("PRICE_USDC must be > 0");
  }
  return trimmed;
}

function usdcToBaseUnits(value: string): string {
  const [wholeRaw, fractionRaw = ""] = value.split(".");
  const whole = wholeRaw || "0";
  const fraction = `${fractionRaw}000000`.slice(0, USDC_DECIMALS);
  const normalized = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  return normalized || "0";
}

export function loadConfig(env: EnvLike = process.env): AppConfig {
  const chainId = parseIntEnv(env, "CHAIN_ID", REQUIRED_CHAIN_ID);
  if (chainId !== REQUIRED_CHAIN_ID) {
    throw new Error(`CHAIN_ID must be ${REQUIRED_CHAIN_ID}, received: ${chainId}`);
  }

  const nodeEnv = env.NODE_ENV ?? "development";
  const x402DevBypass = parseBoolEnv(env, "X402_DEV_BYPASS", false);
  if (nodeEnv === "production" && x402DevBypass) {
    throw new Error("X402_DEV_BYPASS cannot be enabled in production");
  }

  const priceUsdc = normalizeUsdcPrice(requireEnv(env, "PRICE_USDC"));

  return {
    nodeEnv,
    port: parseIntEnv(env, "PORT", 3000),
    logLevel: env.LOG_LEVEL ?? "info",
    serviceName: requireEnv(env, "SERVICE_NAME"),
    version: env.npm_package_version ?? "1.0.0",
    chainId,
    baseRpcUrl: requireEnv(env, "BASE_RPC_URL"),
    sellerPrivateKey: parsePrivateKey(requireEnv(env, "SELLER_PRIVATE_KEY"), "SELLER_PRIVATE_KEY"),
    usdcContract: parseHexAddress(requireEnv(env, "USDC_CONTRACT"), "USDC_CONTRACT"),
    receiverAddress: parseHexAddress(requireEnv(env, "RECEIVER_ADDRESS"), "RECEIVER_ADDRESS"),
    priceUsdc,
    priceBaseUnits: usdcToBaseUnits(priceUsdc),
    publicBaseUrl: requireEnv(env, "PUBLIC_BASE_URL"),
    rateLimitPerMin: parseIntEnv(env, "RATE_LIMIT_PER_MIN", 100),
    rateLimitUnpaidPerMin: parseIntEnv(env, "RATE_LIMIT_UNPAID_PER_MIN", 20),
    bodyLimitBytes: parseIntEnv(env, "BODY_LIMIT_KB", 10) * 1024,
    requestTimeoutMs: parseIntEnv(env, "REQUEST_TIMEOUT_MS", 10_000),
    upstreamTimeoutMs: parseIntEnv(env, "UPSTREAM_TIMEOUT_MS", 3_000),
    upstreamHealthUrl: env.UPSTREAM_HEALTH_URL,
    x402DevBypass,
    metricsEnabled: parseBoolEnv(env, "METRICS_ENABLED", false),
    metricsSecret: env.METRICS_SECRET,
  };
}
