import { getAddress, verifyMessage, type Hex } from "viem";

interface D1Result<T = unknown> {
  results?: T[];
  meta?: { changes?: number };
}
interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<D1Result>;
      all<T = unknown>(): Promise<D1Result<T>>;
    };
  };
}
interface Env {
  AGENT_REQUESTS_DB?: D1Database;
  ORVYNN_APP_ORIGIN?: string;
}
type PendingRequest = {
  id: string;
  lease_id: string;
  delegate_address: string;
  recipient_address: string;
  amount_usdc: string;
  purpose: string | null;
  chain_id: number;
  agentpay_address: string;
  status: string;
  created_at: number;
  expires_at: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 8192) throw new Error("Request body is too large.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.AGENT_REQUESTS_DB) return json({ error: "Delegate inbox storage is not configured." }, 503);
  if (!env.ORVYNN_APP_ORIGIN) return json({ error: "Delegate authentication origin is not configured." }, 503);

  let body: Record<string, unknown>;
  let wallet: string;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "Content-Type must be application/json." }, 415);
  }
  try {
    body = await readJson(request);
    if (typeof body.wallet !== "string" || typeof body.nonce !== "string" || typeof body.signature !== "string") {
      return json({ error: "Provide wallet, nonce and signature." }, 400);
    }
    wallet = getAddress(body.wallet);
    if (!/^([0-9a-f]{64})$/i.test(body.nonce)) return json({ error: "Invalid authentication nonce." }, 400);
    if (!/^0x[0-9a-f]{130}$/i.test(body.signature)) return json({ error: "Invalid wallet signature." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid authentication request." }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const nonceHash = await sha256(body.nonce as string);
  try {
    const challenge = await env.AGENT_REQUESTS_DB.prepare(
      "SELECT wallet_address, created_at, expires_at FROM delegate_auth_nonces WHERE nonce_hash = ?"
    ).bind(nonceHash).first<{ wallet_address: string; created_at: number; expires_at: number }>();

    if (!challenge || challenge.wallet_address.toLowerCase() !== wallet.toLowerCase() ||
        challenge.expires_at <= now || challenge.created_at > now + 30) {
      return json({ error: "Authentication challenge is missing, expired or belongs to another wallet." }, 401);
    }

    const origin = new URL(env.ORVYNN_APP_ORIGIN).origin;
    const message = [
      "Orvynn delegate payment inbox authentication",
      "",
      "This signature proves wallet control for one inbox request. It does not authorize or submit a payment.",
      `Origin: ${origin}`,
      `Wallet: ${wallet}`,
      `Nonce: ${body.nonce as string}`,
      `Issued At: ${new Date(challenge.created_at * 1000).toISOString()}`,
      `Expiration Time: ${new Date(challenge.expires_at * 1000).toISOString()}`,
    ].join("\n");

    const valid = await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: body.signature as Hex,
    });
    if (!valid) return json({ error: "Wallet signature verification failed." }, 401);

    // Conditional deletion is the replay-protection boundary: only one concurrent
    // request can consume a challenge and retrieve the inbox.
    const consumed = await env.AGENT_REQUESTS_DB.prepare(
      "DELETE FROM delegate_auth_nonces WHERE nonce_hash = ? AND wallet_address = ? AND expires_at > ?"
    ).bind(nonceHash, wallet.toLowerCase(), now).run();
    if ((consumed.meta?.changes ?? 0) !== 1) return json({ error: "Authentication challenge has already been used or expired." }, 401);

    await env.AGENT_REQUESTS_DB.prepare(
      "UPDATE agent_payment_requests SET status = 'expired', updated_at = ? WHERE delegate_address = ? AND status = 'pending' AND expires_at <= ?"
    ).bind(now, wallet.toLowerCase(), now).run();

    const result = await env.AGENT_REQUESTS_DB.prepare(
      "SELECT id, lease_id, delegate_address, recipient_address, amount_usdc, purpose, chain_id, agentpay_address, status, created_at, expires_at FROM agent_payment_requests WHERE delegate_address = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 50"
    ).bind(wallet.toLowerCase(), now).all<PendingRequest>();

    return json({
      wallet,
      requests: (result.results ?? []).map((item) => ({
        id: item.id,
        leaseId: item.lease_id,
        delegate: item.delegate_address,
        recipient: item.recipient_address,
        amountUsdc: item.amount_usdc,
        purpose: item.purpose,
        chainId: item.chain_id,
        contract: item.agentpay_address,
        status: item.status,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        requiresDelegateWalletConfirmation: true,
      })),
    });
  } catch {
    return json({ error: "Delegate authentication or inbox retrieval failed." }, 503);
  }
};
