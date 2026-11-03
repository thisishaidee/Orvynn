import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  type Hash,
} from "viem";
import { agentPayAbi } from "../../../../agent/src/agentpay-abi.js";

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
}
interface Env {
  AGENT_REQUESTS_DB?: D1Database;
  ARC_RPC_URL?: string;
}
type StoredRequest = {
  id: string;
  lease_id: string;
  delegate_address: string;
  recipient_address: string;
  amount_base_units: string;
  agentpay_address: string;
  status: string;
  expires_at: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.AGENT_REQUESTS_DB) return json({ error: "Delegate inbox storage is not configured." }, 503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  let requestId: string;
  let transactionHash: Hash;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: "Request body is too large." }, 413);
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Provide requestId and transactionHash." }, 400);
    const value = body as Record<string, unknown>;
    if (typeof value.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.requestId)) {
      return json({ error: "Invalid payment request ID." }, 400);
    }
    if (typeof value.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(value.transactionHash)) {
      return json({ error: "Invalid transaction hash." }, 400);
    }
    requestId = value.requestId;
    transactionHash = value.transactionHash as Hash;
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  try {
    const row = await env.AGENT_REQUESTS_DB.prepare(
      "SELECT id, lease_id, delegate_address, recipient_address, amount_base_units, agentpay_address, status, expires_at FROM agent_payment_requests WHERE id = ?"
    ).bind(requestId).first<StoredRequest>();
    if (!row) return json({ error: "Payment request was not found." }, 404);
    if (row.status !== "pending") return json({ error: "Payment request is no longer pending." }, 409);

    const rpcUrl = env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
    const arc = defineChain({
      id: 5042,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const client = createPublicClient({ chain: arc, transport: http(rpcUrl) });
    if (await client.getChainId() !== 5042) return json({ error: "RPC is not connected to Arc Mainnet." }, 503);

    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: transactionHash }),
      client.getTransactionReceipt({ hash: transactionHash }),
    ]);
    if (receipt.status !== "success") return json({ error: "The supplied transaction did not succeed." }, 422);

    const contract = getAddress(row.agentpay_address);
    if (transaction.from.toLowerCase() !== row.delegate_address.toLowerCase()) {
      return json({ error: "Transaction sender does not match the registered delegate." }, 422);
    }
    if (!transaction.to || transaction.to.toLowerCase() !== contract.toLowerCase() || transaction.value !== 0n) {
      return json({ error: "Transaction does not target the expected AgentPay contract." }, 422);
    }

    const decoded = decodeFunctionData({ abi: agentPayAbi, data: transaction.input });
    if (decoded.functionName !== "spend") return json({ error: "Transaction is not an AgentPay spend call." }, 422);
    const [leaseId, recipient, amount] = decoded.args;
    if (
      leaseId.toString() !== row.lease_id ||
      recipient.toLowerCase() !== row.recipient_address.toLowerCase() ||
      amount.toString() !== row.amount_base_units
    ) {
      return json({ error: "On-chain spend details do not match this payment request." }, 422);
    }

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (Number(block.timestamp) > row.expires_at) {
      return json({ error: "The payment request expired before the transaction was mined." }, 409);
    }

    const now = Math.floor(Date.now() / 1000);
    const updated = await env.AGENT_REQUESTS_DB.prepare(
      "UPDATE agent_payment_requests SET status = 'confirmed', transaction_hash = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND delegate_address = ?"
    ).bind(transactionHash, now, requestId, row.delegate_address.toLowerCase()).run();
    if ((updated.meta?.changes ?? 0) !== 1) {
      return json({ error: "Payment request changed before confirmation could be recorded." }, 409);
    }
    return json({ status: "confirmed", requestId, transactionHash, blockNumber: receipt.blockNumber.toString() });
  } catch {
    return json({ error: "Could not verify and record the on-chain payment." }, 503);
  }
};
