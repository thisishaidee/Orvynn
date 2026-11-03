import "dotenv/config";
import { publicClient, agentPayAddress, usdcAddress } from "./chain.js";
import { agentPayAbi, erc20ReadAbi } from "./agentpay-abi.js";

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 5042) {
    throw new Error(`RPC returned chain ID ${chainId}; expected Arc Mainnet (5042).`);
  }

  const [agentPayCode, usdcCode, usdcDecimals, configuredUsdc] = await Promise.all([
    publicClient.getCode({ address: agentPayAddress }),
    publicClient.getCode({ address: usdcAddress }),
    publicClient.readContract({ address: usdcAddress, abi: erc20ReadAbi, functionName: "decimals" }),
    publicClient.readContract({ address: agentPayAddress, abi: agentPayAbi, functionName: "USDC" })
  ]);

  if (!agentPayCode || agentPayCode === "0x") throw new Error("No contract code found at the Orvynn contract (AgentPay) address.");
  if (!usdcCode || usdcCode === "0x") throw new Error("No contract code found at Arc USDC address.");
  if (usdcDecimals !== 6) throw new Error(`Unexpected USDC decimals: ${usdcDecimals}; expected 6.`);
  if (configuredUsdc.toLowerCase() !== usdcAddress.toLowerCase()) {
    throw new Error(`Configured USDC address ${usdcAddress} does not match the token hardcoded in the Orvynn contract (AgentPay) (${configuredUsdc}).`);
  }

  console.log("Arc connection verified.");
  console.log(`Chain ID: ${chainId}`);
  console.log(`Orvynn contract (AgentPay): ${agentPayAddress}`);
  console.log(`Arc USDC: ${usdcAddress} (6 decimals)`);
  console.log("Mode: read-only. No wallet key loaded; no transaction sent.");
}

main().catch((error: unknown) => {
  console.error("Agent startup check failed:", error);
  process.exitCode = 1;
});
