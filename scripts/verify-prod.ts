import { randomUUID } from "node:crypto";

import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { createPublicClient, http } from "viem";
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

function parseArg(name: string): string | undefined {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return undefined;
  return arg.slice(name.length + 3);
}

function usdcToUnits(price: string): bigint {
  const [wholeRaw, fractionRaw = ""] = price.split(".");
  const whole = BigInt(wholeRaw || "0");
  const fraction = BigInt(`${fractionRaw}000000`.slice(0, 6));
  return whole * 1_000_000n + fraction;
}

async function expectStatus(response: Response, expected: number, message: string): Promise<void> {
  if (response.status !== expected) {
    const text = await response.text();
    throw new Error(`${message}. Expected ${expected}, got ${response.status}. Body: ${text}`);
  }
}

async function main(): Promise<void> {
  const baseUrl = parseArg("baseUrl") ?? process.env.VERIFY_BASE_URL ?? process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error("Missing base URL. Use --baseUrl=https://... or VERIFY_BASE_URL env var");
  }

  const buyerPrivateKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!buyerPrivateKey) {
    throw new Error("Missing BUYER_PRIVATE_KEY env var for paid verification");
  }

  const chainId = Number(process.env.CHAIN_ID ?? "8453");
  if (chainId !== 8453) {
    throw new Error(`Expected CHAIN_ID=8453, got ${chainId}`);
  }

  const baseRpcUrl = process.env.BASE_RPC_URL;
  const usdcContract = process.env.USDC_CONTRACT as `0x${string}` | undefined;
  const receiverAddress = process.env.RECEIVER_ADDRESS as `0x${string}` | undefined;
  const priceUsdc = process.env.PRICE_USDC;

  if (!baseRpcUrl || !usdcContract || !receiverAddress || !priceUsdc) {
    throw new Error("Missing BASE_RPC_URL, USDC_CONTRACT, RECEIVER_ADDRESS, or PRICE_USDC env vars");
  }

  const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: `eip155:${chainId}`,
        client: new ExactEvmScheme(privateKeyToAccount(buyerPrivateKey)),
      },
    ],
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http(baseRpcUrl),
  });

  const healthz = await fetch(`${baseUrl}/healthz`);
  await expectStatus(healthz, 200, "healthz failed");

  const meta = await fetch(`${baseUrl}/meta`);
  await expectStatus(meta, 200, "meta failed");

  const unpaid = await fetch(`${baseUrl}/v1/echo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ probe: "unpaid-check" }),
  });
  await expectStatus(unpaid, 402, "unpaid call should return 402");

  const beforeBalance = await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [receiverAddress],
  });

  const idempotencyKey = randomUUID();
  const paidResponse = await paidFetch(`${baseUrl}/v1/echo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ probe: "paid-check", idempotencyKey }),
  });
  await expectStatus(paidResponse, 200, "paid call should return 200");

  const paidBody = (await paidResponse.json()) as {
    ok?: boolean;
    receipt?: Record<string, unknown>;
  };
  if (!paidBody.ok || !paidBody.receipt) {
    throw new Error(`Paid response missing receipt object: ${JSON.stringify(paidBody)}`);
  }

  const paymentResponseHeader = paidResponse.headers.get("payment-response");
  if (!paymentResponseHeader) {
    throw new Error("Missing PAYMENT-RESPONSE header on paid response");
  }
  const settlement = decodePaymentResponseHeader(paymentResponseHeader);

  const afterFirstBalance = await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [receiverAddress],
  });

  const expectedIncrease = usdcToUnits(priceUsdc);
  const actualIncrease = (afterFirstBalance as bigint) - (beforeBalance as bigint);
  if (actualIncrease < expectedIncrease) {
    throw new Error(
      `Receiver balance did not increase as expected. Expected >= ${expectedIncrease}, actual ${actualIncrease}`,
    );
  }

  const replayResponse = await paidFetch(`${baseUrl}/v1/echo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ probe: "paid-check", idempotencyKey }),
  });

  if (replayResponse.status !== 200 && replayResponse.status !== 409) {
    const text = await replayResponse.text();
    throw new Error(`Replay should return 200 or 409, got ${replayResponse.status}: ${text}`);
  }

  const afterReplayBalance = await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [receiverAddress],
  });

  const replayIncrease = (afterReplayBalance as bigint) - (afterFirstBalance as bigint);
  if (replayIncrease > 1n) {
    throw new Error(`Replay appears to have charged again. Additional increase: ${replayIncrease}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        txHash: settlement.transaction,
        payer: settlement.payer,
        receiverIncrease: actualIncrease.toString(),
        replayStatus: replayResponse.status,
      },
      null,
      2,
    ),
  );
}

void main();
