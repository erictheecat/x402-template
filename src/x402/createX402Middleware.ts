import type { IncomingMessage, ServerResponse } from "node:http";

import { x402Facilitator } from "@x402/core/facilitator";
import { type FacilitatorClient, type RoutesConfig, x402ResourceServer } from "@x402/core/server";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { paymentMiddleware } from "@x402/express";
import { createPublicClient, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { adaptExpressLikeRequest, adaptExpressLikeResponse } from "../lib/expressCompat.js";
import type { AppConfig } from "../config.js";

export interface X402Bundle {
  middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: Error) => void) => Promise<void>;
  receiverAddress: string;
}

export function createX402Middleware(config: AppConfig): X402Bundle {
  const account = privateKeyToAccount(config.sellerPrivateKey);
  const transport = http(config.baseRpcUrl, { timeout: config.upstreamTimeoutMs });

  const publicClient = createPublicClient({
    chain: base,
    transport,
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport,
  }).extend(publicActions);

  const facilitatorSigner = toFacilitatorEvmSigner({
    address: account.address,
    readContract: publicClient.readContract,
    verifyTypedData: publicClient.verifyTypedData,
    writeContract: walletClient.writeContract,
    sendTransaction: walletClient.sendTransaction,
    waitForTransactionReceipt: publicClient.waitForTransactionReceipt,
    getCode: publicClient.getCode,
  } as never);

  const facilitator = new x402Facilitator();
  const network = `eip155:${config.chainId}` as `${string}:${string}`;

  registerExactEvmScheme(facilitator, {
    signer: facilitatorSigner,
    networks: network,
  });

  const facilitatorClient: FacilitatorClient = {
    verify: facilitator.verify.bind(facilitator),
    settle: facilitator.settle.bind(facilitator),
    getSupported: async () => {
      const supported = facilitator.getSupported();
      return {
        ...supported,
        kinds: supported.kinds.map((kind) => ({
          ...kind,
          network: kind.network as `${string}:${string}`,
        })),
      };
    },
  };

  const resourceServer = new x402ResourceServer(facilitatorClient);

  const routes: RoutesConfig = {
    "POST /v1/echo": {
      accepts: {
        scheme: "exact",
        network,
        payTo: config.receiverAddress,
        price: {
          asset: config.usdcContract,
          amount: config.priceBaseUnits,
        },
      },
      description: "Paid echo endpoint",
      mimeType: "application/json",
    },
  };

  const expressMiddleware = paymentMiddleware(routes, resourceServer);

  return {
    middleware: async (req, res, next) => {
      await expressMiddleware(adaptExpressLikeRequest(req) as never, adaptExpressLikeResponse(res) as never, next as never);
    },
    receiverAddress: config.receiverAddress,
  };
}
