import "dotenv/config";
import { createPublicClient, defineChain, fallback, http, getAddress } from "viem";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.mainnet.arc.io";
const configuredChainId = Number(process.env.CHAIN_ID ?? "5042");

if (configuredChainId !== 5042) {
  throw new Error("This first agent build is locked to Arc Mainnet (chain ID 5042).");
}

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.network" }
  }
});

export const agentPayAddress = getAddress(
  process.env.AGENTPAY_ADDRESS ?? "0xA549B60313A86288d46323e5723AAa4c0fAA6363"
);

export const usdcAddress = getAddress(
  process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000"
);

const rpcUrls = [...new Set([rpcUrl, "https://rpc.arc-scan.org", "https://rpc.mainnet.arc.io"])]

export const publicClient = createPublicClient({
  chain: arcMainnet,
  // Keep the configured endpoint first, but fail over to the same public Arc
  // endpoints used by the web app when it is unavailable or throttled.
  transport: fallback(rpcUrls.map((url) => http(url)))
});
