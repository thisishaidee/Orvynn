import {
  createPublicClient,
  decodeFunctionData,
  decodeEventLog,
  parseAbi,
  defineChain,
  getAddress,
  http,
  verifyMessage,
  type Hex,
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
  ORVYNN_APP_ORIGIN?: string;
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
  transaction_hash: string | null;
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

const spentEventAbi = parseAbi(["event Spent(uint256 indexed leaseId, address indexed recipient, uint256 amount)"]);

type CompletionClient = {
  getChainId(): Promise<number>;
  getTransaction(args: { hash: Hash }): Promise<{ from: string; to: string | null; value: bigint; input: Hex }>;
  getTransactionReceipt(args: { hash: Hash }): Promise<{
    status: "success" | "reverted"; blockNumber: bigint;
    logs: Array<{ address: string; topics: readonly Hex[]; data: Hex }>;
  }>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
};

export const onRequestPost = async (
  { request, env }: { request: Request; env: Env },
  dependencies: { createClient?: (rpcUrl: string) => CompletionClient } = {}
) => {
  if (!env.AGENT_REQUESTS_DB) return json({ error: "Delegate inbox storage is not configured." }, 503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  let requestId: string;
  let transactionHash: Hash;
  let wallet: `0x${string}`;
  let nonce: string;
  let signature: Hex;
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
    if (typeof value.wallet !== "string" || typeof value.nonce !== "string" || typeof value.signature !== "string") {
      return json({ error: "Delegate wallet authentication is required." }, 401);
    }
    wallet = getAddress(value.wallet);
    if (!/^[0-9a-f]{64}$/i.test(value.nonce) || !/^0x[0-9a-f]{130}$/i.test(value.signature)) {
      return json({ error: "Invalid delegate authentication proof." }, 400);
    }
    nonce = value.nonce;
    signature = value.signature as Hex;
    requestId = value.requestId;
    transactionHash = value.transactionHash as Hash;
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  try {
    const appOrigin = env.ORVYNN_APP_ORIGIN ? new URL(env.ORVYNN_APP_ORIGIN) : null;
    if (!appOrigin || appOrigin.protocol !== "https:" || appOrigin.pathname !== "/" || appOrigin.search || appOrigin.hash ||
        request.headers.get("origin") !== appOrigin.origin) {
      return json({ error: "Completion must originate from the configured Orvynn app." }, 403);
    }
    const now = Math.floor(Date.now() / 1000);
    const nonceHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
    const nonceHash = Array.from(new Uint8Array(nonceHashBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const challenge = await env.AGENT_REQUESTS_DB.prepare(
      "SELECT wallet_address, created_at, expires_at FROM delegate_auth_nonces WHERE nonce_hash = ?"
    ).bind(nonceHash).first<{ wallet_address: string; created_at: number; expires_at: number }>();
    if (!challenge || challenge.wallet_address.toLowerCase() !== wallet.toLowerCase() ||
        challenge.expires_at <= now || challenge.created_at > now + 30) {
      return json({ error: "Delegate authentication challenge is missing, expired or belongs to another wallet." }, 401);
    }
    const message = [
      "Orvynn delegate payment inbox authentication",
      "",
      "This signature proves wallet control for one inbox request. It does not authorize or submit a payment.",
      `Origin: ${appOrigin.origin}`,
      `Wallet: ${wallet}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(challenge.created_at * 1000).toISOString()}`,
      `Expiration Time: ${new Date(challenge.expires_at * 1000).toISOString()}`,
    ].join("\n");
    if (!await verifyMessage({ address: wallet, message, signature })) {
      return json({ error: "Delegate wallet signature verification failed." }, 401);
    }
    const consumed = await env.AGENT_REQUESTS_DB.prepare(
      "DELETE FROM delegate_auth_nonces WHERE nonce_hash = ? AND wallet_address = ? AND expires_at > ?"
    ).bind(nonceHash, wallet.toLowerCase(), now).run();
    if ((consumed.meta?.changes ?? 0) !== 1) {
      return json({ error: "Delegate authentication challenge has already been used or expired." }, 401);
    }

    const row = await env.AGENT_REQUESTS_DB.prepare(
      "SELECT id, lease_id, delegate_address, recipient_address, amount_base_units, agentpay_address, status, expires_at, transaction_hash FROM agent_payment_requests WHERE id = ?"
    ).bind(requestId).first<StoredRequest>();
    if (!row) return json({ error: "Payment request was not found." }, 404);
    if (wallet.toLowerCase() !== row.delegate_address.toLowerCase()) {
      return json({ error: "Authenticated wallet is not the registered delegate for this request." }, 403);
    }
    if (row.status === "confirmed" && row.transaction_hash?.toLowerCase() === transactionHash.toLowerCase()) {
      return json({ status: "confirmed", requestId, transactionHash, idempotent: true });
    }
    if (row.status !== "pending") return json({ error: "Payment request is no longer pending." }, 409);

    const rpcUrl = env.ARC_RPC_URL || "https://rpc.mainnet.arc.io";
    const arc = defineChain({
      id: 5042,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const client = dependencies.createClient
      ? dependencies.createClient(rpcUrl)
      : createPublicClient({ chain: arc, transport: http(rpcUrl) }) as unknown as CompletionClient;
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

    const spentLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== contract.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: spentEventAbi, data: log.data, topics: [...log.topics] });
        return event.eventName === "Spent" &&
          event.args.leaseId.toString() === row.lease_id &&
          event.args.recipient.toLowerCase() === row.recipient_address.toLowerCase() &&
          event.args.amount.toString() === row.amount_base_units;
      } catch { return false; }
    });
    if (!spentLog) return json({ error: "Successful receipt does not contain the matching AgentPay spend event." }, 422);

    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (Number(block.timestamp) > row.expires_at) {
      return json({ error: "The payment request expired before the transaction was mined." }, 409);
    }

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
