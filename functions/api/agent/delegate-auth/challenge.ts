import { getAddress } from "viem";

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
const NONCE_TTL_SECONDS = 5 * 60;

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
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4096) throw new Error("Request body is too large.");
  try { return JSON.parse(text); } catch { throw new Error("Request body must be valid JSON."); }
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.AGENT_REQUESTS_DB) return json({ error: "Delegate inbox storage is not configured." }, 503);
  if (!env.ORVYNN_APP_ORIGIN) return json({ error: "Delegate authentication origin is not configured." }, 503);

  let wallet: string;
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).wallet !== "string") {
      return json({ error: "Provide a wallet address." }, 400);
    }
    wallet = getAddress((body as { wallet: string }).wallet);
    if (wallet === "0x0000000000000000000000000000000000000000") return json({ error: "Zero address is not a valid delegate." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid wallet address." }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + NONCE_TTL_SECONDS;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const origin = new URL(env.ORVYNN_APP_ORIGIN).origin;
  const message = [
    "Orvynn delegate payment inbox authentication",
    "",
    "This signature proves wallet control for one inbox request. It does not authorize or submit a payment.",
    `Origin: ${origin}`,
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(now * 1000).toISOString()}`,
    `Expiration Time: ${new Date(expiresAt * 1000).toISOString()}`,
  ].join("\n");

  try {
    await env.AGENT_REQUESTS_DB.prepare(
      "INSERT INTO delegate_auth_nonces (nonce_hash, wallet_address, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(await sha256(nonce), wallet.toLowerCase(), now, expiresAt).run();
    await env.AGENT_REQUESTS_DB.prepare("DELETE FROM delegate_auth_nonces WHERE expires_at <= ?").bind(now).run();
  } catch {
    return json({ error: "Could not create an authentication challenge." }, 503);
  }
  return json({ wallet, nonce, message, expiresAt });
};
