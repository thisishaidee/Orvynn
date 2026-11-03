import { createPublicClient, defineChain, formatUnits, getAddress, http } from "viem";
import { agentPayAbi } from "../../../../agent/src/agentpay-abi.js";
import { assertLeasePaymentAllowed } from "../../../../agent/src/lease-payment-guards.js";
import { validatePaymentInput } from "../../../../agent/src/payment-validation.js";

interface Env {
  AGENT_API_TOKEN?: string;
  ARC_RPC_URL?: string;
  AGENTPAY_ADDRESS?: string;
  USDC_ADDRESS?: string;
}
const DEFAULT_AGENTPAY = "0xA549B60313A86288d46323e5723AAa4c0fAA6363";
const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";
const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }});
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Request body exceeds the 16 KB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("Request body must be valid JSON."); }
}
function parseBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide a JSON object with leaseId, delegate, recipient and amountUsdc.");
  const body = value as Record<string, unknown>;
  for (const key of ["leaseId", "delegate", "recipient", "amountUsdc"] as const) {
    if (typeof body[key] !== "string" || body[key].trim() === "") throw new Error(`'${key}' must be a non-empty string.`);
  }
  if (!/^\d+$/.test(body.leaseId as string) || BigInt(body.leaseId as string) <= 0n) throw new Error("'leaseId' must be a positive integer string.");
  if (body.purpose !== undefined && (typeof body.purpose !== "string" || body.purpose.length > 240)) throw new Error("'purpose' must be a string of at most 240 characters.");
  return {
    leaseId: BigInt(body.leaseId as string),
    delegate: body.delegate as string,
    recipient: body.recipient as string,
    amountUsdc: body.amountUsdc as string,
    purpose: typeof body.purpose === "string" ? body.purpose.trim() : null
  };
}

export const onRequestGet = async () => {
  return json({ ok: true, service: "orvynn-agent", mode: "payment-preparation-only", chainId: 5042 });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.AGENT_API_TOKEN) return json({ error: "Agent API is not configured. Set AGENT_API_TOKEN as a Pages secret." }, 503);
  if (request.headers.get("authorization") !== `Bearer ${env.AGENT_API_TOKEN}`) return json({ error: "Missing or invalid API token." }, 401);

  let input: ReturnType<typeof parseBody>;
  try { input = parseBody(await readBody(request)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, 400); }

  try {
    const rpcUrl = env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
    const contract = getAddress(env.AGENTPAY_ADDRESS || DEFAULT_AGENTPAY);
    const usdc = getAddress(env.USDC_ADDRESS || DEFAULT_USDC);
    const arc = defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    const payment = validatePaymentInput(input);
    const client = createPublicClient({ chain: arc, transport: http(rpcUrl) });
    if (await client.getChainId() !== 5042) throw new Error("RPC is not connected to Arc Mainnet (chain ID 5042).");
    const [lease, allowance, latestBlock, configuredUsdc] = await Promise.all([
      client.readContract({ address: contract, abi: agentPayAbi, functionName: "leases", args: [payment.leaseId] }),
      client.readContract({ address: contract, abi: agentPayAbi, functionName: "remainingAllowance", args: [payment.leaseId] }),
      client.getBlock({ blockTag: "latest" }),
      client.readContract({ address: contract, abi: agentPayAbi, functionName: "USDC" })
    ]);
    if (configuredUsdc.toLowerCase() !== usdc.toLowerCase()) throw new Error("Configured USDC address does not match the token configured in the deployed Orvynn contract (AgentPay).");
    const [owner, delegate, , , expiry, , , , balance, allowlistEnabled, revoked] = lease;
    const recipientAllowed = allowlistEnabled
      ? await client.readContract({ address: contract, abi: agentPayAbi, functionName: "allowedRecipients", args: [payment.leaseId, payment.recipient] })
      : false;
    assertLeasePaymentAllowed({
      lease: { owner, delegate, expiry, revoked, balance, remainingAllowance: allowance, allowlistEnabled, recipientAllowed },
      suppliedDelegate: payment.delegate, amount: payment.amount, nowSeconds: latestBlock.timestamp
    });
    await client.simulateContract({ account: payment.delegate, address: contract, abi: agentPayAbi, functionName: "spend", args: [payment.leaseId, payment.recipient, payment.amount] });

    return json({
      status: "ready_for_delegate_approval",
      purpose: input.purpose,
      payment: {
        leaseId: payment.leaseId.toString(), delegate: payment.delegate, recipient: payment.recipient,
        amountUsdc: payment.amountUsdc, amountBaseUnits: payment.amount.toString(),
        remainingAllowanceUsdc: formatUnits(allowance, 6), contract, chainId: 5042,
        requiresDelegateWalletConfirmation: true
      },
      execution: { submitted: false, signed: false, requiresDelegateWalletConfirmation: true }
    });
  } catch (error) {
    return json({ status: "rejected", error: error instanceof Error ? error.message : "Payment request could not be prepared." }, 422);
  }
};
