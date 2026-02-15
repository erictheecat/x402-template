import { randomUUID } from "node:crypto";

import { ExactEvmScheme } from "@x402/evm";
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { formatEther, formatUnits, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const USDC_DECIMALS = 6;
const USDC_TOLERANCE_UNITS = 2n;

function parseArg(name: string): string | undefined {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg.slice(name.length + 3);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[MISSING_ENV] Missing required env var: ${name}`);
  }
  return value;
}

function usdcToUnits(value: string): bigint {
  const [wholeRaw, fractionRaw = ""] = value.split(".");
  const whole = BigInt(wholeRaw || "0");
  const fraction = BigInt(`${fractionRaw}000000`.slice(0, USDC_DECIMALS));
  return whole * 1_000_000n + fraction;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`[INVALID_ROUTE] Route path must start with '/': ${path}`);
  }
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

async function expectStatus(response: Response, expected: number, message: string): Promise<void> {
  if (response.status !== expected) {
    const text = await response.text();
    throw new Error(`${message}. Expected ${expected}, got ${response.status}. Body: ${text}`);
  }
}

async function main(): Promise<void> {
  const baseUrl = normalizeBaseUrl(
    parseArg("baseUrl") ?? process.env.VERIFY_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? "",
  );

  if (!baseUrl) {
    throw new Error("[MISSING_BASE_URL] Use --baseUrl=... or set VERIFY_BASE_URL/PUBLIC_BASE_URL");
  }

  const paidRoute = parseArg("route") ?? process.env.VERIFY_ROUTE ?? "/v1/echo";

  const chainId = Number(process.env.CHAIN_ID ?? "8453");
  if (chainId !== 8453) {
    throw new Error(`[CHAIN_ID_INVALID] Expected CHAIN_ID=8453, got ${chainId}`);
  }

  const baseRpcUrl = requireEnv("BASE_RPC_URL");
  const usdcContract = requireEnv("USDC_CONTRACT") as `0x${string}`;
  const receiverAddress = requireEnv("RECEIVER_ADDRESS") as `0x${string}`;
  const priceUsdc = requireEnv("PRICE_USDC");
  const buyerPrivateKey = requireEnv("BUYER_PRIVATE_KEY") as `0x${string}`;
  const sellerPrivateKey = process.env.SELLER_PRIVATE_KEY as `0x${string}` | undefined;

  const expectedUnits = usdcToUnits(priceUsdc);

  const buyerAccount = privateKeyToAccount(buyerPrivateKey);
  const sellerAccount = sellerPrivateKey ? privateKeyToAccount(sellerPrivateKey) : undefined;

  const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: `eip155:${chainId}`,
        client: new ExactEvmScheme(buyerAccount),
      },
    ],
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http(baseRpcUrl),
  });

  const buyerEthBalance = await publicClient.getBalance({ address: buyerAccount.address });
  if (buyerEthBalance <= 0n) {
    throw new Error(
      `[INSUFFICIENT_BUYER_ETH] Buyer wallet ${buyerAccount.address} has 0 ETH on Base; fund gas and retry`,
    );
  }

  const buyerUsdcBalance = (await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [buyerAccount.address],
  })) as bigint;

  if (buyerUsdcBalance < expectedUnits) {
    throw new Error(
      `[INSUFFICIENT_BUYER_USDC] Buyer wallet ${buyerAccount.address} has ${formatUnits(buyerUsdcBalance, USDC_DECIMALS)} USDC, requires at least ${priceUsdc}`,
    );
  }

  if (sellerAccount) {
    const sellerEthBalance = await publicClient.getBalance({ address: sellerAccount.address });
    if (sellerEthBalance <= 0n) {
      throw new Error(
        `[INSUFFICIENT_SELLER_ETH] Seller wallet ${sellerAccount.address} has 0 ETH on Base; settlement gas will fail`,
      );
    }
  }

  const healthz = await fetch(joinUrl(baseUrl, "/healthz"));
  await expectStatus(healthz, 200, "healthz failed");

  const meta = await fetch(joinUrl(baseUrl, "/meta"));
  await expectStatus(meta, 200, "meta failed");

  const unpaid = await fetch(joinUrl(baseUrl, paidRoute), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ probe: "unpaid-check" }),
  });

  if (unpaid.status === 404 || unpaid.status === 405) {
    const text = await unpaid.text();
    throw new Error(
      `[ROUTE_MISMATCH] ${paidRoute} returned ${unpaid.status}. Ensure x402 route mapping and verifier route match. Body: ${text}`,
    );
  }

  if (unpaid.status === 200) {
    throw new Error(
      `[PAYMENT_GATE_DISABLED] Unpaid request succeeded on ${paidRoute}. Ensure x402 gate is enabled and bypass is off`,
    );
  }

  await expectStatus(unpaid, 402, `Unpaid call to ${paidRoute} should return 402`);

  const paymentRequiredHeader = unpaid.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error("[MISSING_PAYMENT_REQUIRED_HEADER] 402 response missing PAYMENT-REQUIRED header");
  }

  const receiverBalanceBefore = (await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [receiverAddress],
  })) as bigint;

  const idempotencyKey = randomUUID();

  const paidResponse = await paidFetch(joinUrl(baseUrl, paidRoute), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ probe: "paid-check", idempotencyKey }),
  });

  await expectStatus(paidResponse, 200, "Paid call should return 200");

  const paidBody = (await paidResponse.json()) as {
    ok?: boolean;
    receipt?: Record<string, unknown>;
  };

  if (!paidBody.ok || !paidBody.receipt) {
    throw new Error(`[RECEIPT_MISSING] Paid response missing receipt object: ${JSON.stringify(paidBody)}`);
  }

  const paymentResponseHeader = paidResponse.headers.get("payment-response");
  if (!paymentResponseHeader) {
    throw new Error("[MISSING_PAYMENT_RESPONSE_HEADER] 200 response missing PAYMENT-RESPONSE header");
  }

  const settlement = decodePaymentResponseHeader(paymentResponseHeader);

  const receiverBalanceAfterFirst = (await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [receiverAddress],
  })) as bigint;

  const receiverIncrease = receiverBalanceAfterFirst - receiverBalanceBefore;
  if (receiverIncrease + USDC_TOLERANCE_UNITS < expectedUnits) {
    throw new Error(
      `[RECEIVER_BALANCE_DELTA_LOW] Expected receiver delta >= ${expectedUnits} units, got ${receiverIncrease} units`,
    );
  }

  const replayResponse = await paidFetch(joinUrl(baseUrl, paidRoute), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ probe: "paid-check", idempotencyKey }),
  });

  if (replayResponse.status !== 200 && replayResponse.status !== 409) {
    const replayText = await replayResponse.text();
    throw new Error(
      `[IDEMPOTENCY_UNEXPECTED_STATUS] Replay expected 200 or 409, got ${replayResponse.status}: ${replayText}`,
    );
  }

  const receiverBalanceAfterReplay = (await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [receiverAddress],
  })) as bigint;

  const replayIncrease = receiverBalanceAfterReplay - receiverBalanceAfterFirst;
  if (replayIncrease > USDC_TOLERANCE_UNITS) {
    throw new Error(
      `[IDEMPOTENCY_DOUBLE_CHARGE] Replay increased receiver balance by ${replayIncrease} units`,
    );
  }

  const mode = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") ? "local-real" : "railway";

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode,
        baseUrl,
        route: paidRoute,
        txHash: settlement.transaction,
        payer: settlement.payer,
        buyer: buyerAccount.address,
        buyerEth: formatEther(buyerEthBalance),
        buyerUsdc: formatUnits(buyerUsdcBalance, USDC_DECIMALS),
        receiver: receiverAddress,
        receiverIncreaseUnits: receiverIncrease.toString(),
        receiverIncreaseUsdc: formatUnits(receiverIncrease, USDC_DECIMALS),
        replayStatus: replayResponse.status,
        replayIncreaseUnits: replayIncrease.toString(),
      },
      null,
      2,
    ),
  );
}

void main();
