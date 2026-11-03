import type { Address } from "viem";
import { publicClient, agentPayAddress, usdcAddress } from "./chain.js";
import { agentPayAbi, erc20ReadAbi } from "./agentpay-abi.js";

export type ArcDeploymentReader = {
  getChainId(): Promise<number>;
  getCode(args: { address: Address }): Promise<`0x${string}` | undefined>;
  readContract(args: {
    address: Address;
    abi: typeof agentPayAbi | typeof erc20ReadAbi;
    functionName: "USDC" | "decimals";
  }): Promise<unknown>;
};

/**
 * Read-only preflight for the live payment API. Refuses to serve payment
 * preparation requests unless the RPC, AgentPay deployment and USDC config
 * match the expected Arc Mainnet deployment.
 */
export async function verifyArcDeployment(
  client: ArcDeploymentReader = publicClient as ArcDeploymentReader
): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId !== 5042) {
    throw new Error(`RPC returned chain ID ${chainId}; expected Arc Mainnet (5042).`);
  }

  const [agentPayCode, usdcCode, usdcDecimals, configuredUsdc] = await Promise.all([
    client.getCode({ address: agentPayAddress }),
    client.getCode({ address: usdcAddress }),
    client.readContract({ address: usdcAddress, abi: erc20ReadAbi, functionName: "decimals" }),
    client.readContract({ address: agentPayAddress, abi: agentPayAbi, functionName: "USDC" })
  ]);

  if (!agentPayCode || agentPayCode === "0x") {
    throw new Error("No contract code found at the configured AgentPay address.");
  }
  if (!usdcCode || usdcCode === "0x") {
    throw new Error("No contract code found at the configured Arc USDC address.");
  }
  if (usdcDecimals !== 6) {
    throw new Error(`Unexpected USDC decimals: ${String(usdcDecimals)}; expected 6.`);
  }
  if (typeof configuredUsdc !== "string" || configuredUsdc.toLowerCase() !== usdcAddress.toLowerCase()) {
    throw new Error("The AgentPay contract's USDC address does not match the configured Arc USDC address.");
  }
}
