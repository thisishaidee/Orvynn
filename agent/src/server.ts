import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prepareLeasePayment } from "./payment.js";
import { verifyArcDeployment } from "./deployment-check.js";

const MAX_BODY_BYTES = 16 * 1024;
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const API_TOKEN = process.env.AGENT_API_TOKEN;

type PaymentRequestBody = {
  leaseId: string;
  delegate: string;
  recipient: string;
  amountUsdc: string;
  purpose?: string;
};

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds the 16 KB limit.");
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function parsePaymentRequest(value: unknown): PaymentRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provide a JSON object with leaseId, delegate, recipient and amountUsdc.");
  }
  const body = value as Record<string, unknown>;
  const required = ["leaseId", "delegate", "recipient", "amountUsdc"] as const;
  for (const key of required) {
    if (typeof body[key] !== "string" || body[key].trim() === "") {
      throw new Error(`'${key}' must be a non-empty string.`);
    }
  }
  if (!/^\d+$/.test(body.leaseId as string) || BigInt(body.leaseId as string) <= 0n) {
    throw new Error("'leaseId' must be a positive integer string.");
  }
  if (body.purpose !== undefined && (typeof body.purpose !== "string" || body.purpose.length > 240)) {
    throw new Error("'purpose' must be a string of at most 240 characters.");
  }
  return {
    leaseId: body.leaseId as string,
    delegate: body.delegate as string,
    recipient: body.recipient as string,
    amountUsdc: body.amountUsdc as string,
    ...(typeof body.purpose === "string" ? { purpose: body.purpose.trim() } : {})
  };
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { ok: true, service: "orvynn-agent", mode: "payment-preparation-only", chainId: 5042 });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/v1/payment-requests/prepare") {
    send(response, 404, { error: "Route not found." });
    return;
  }

  if (API_TOKEN && request.headers.authorization !== `Bearer ${API_TOKEN}`) {
    send(response, 401, { error: "Missing or invalid API token." });
    return;
  }
  if (process.env.NODE_ENV === "production" && !API_TOKEN) {
    send(response, 503, { error: "Configure AGENT_API_TOKEN before exposing this service." });
    return;
  }

  let body: PaymentRequestBody;
  try {
    body = parsePaymentRequest(await readJson(request));
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : "Invalid request." });
    return;
  }

  try {
    const prepared = await prepareLeasePayment({
      leaseId: BigInt(body.leaseId),
      delegate: body.delegate as `0x${string}`,
      recipient: body.recipient as `0x${string}`,
      amountUsdc: body.amountUsdc
    });
    send(response, 200, {
      status: "ready_for_delegate_approval",
      purpose: body.purpose ?? null,
      payment: prepared,
      execution: {
        submitted: false,
        signed: false,
        requiresDelegateWalletConfirmation: true
      }
    });
  } catch (error) {
    send(response, 422, {
      status: "rejected",
      error: error instanceof Error ? error.message : "Payment request could not be prepared."
    });
  }
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    if (!response.headersSent) send(response, 500, { error: "Unexpected agent service error." });
    else response.destroy();
  });
});

async function start(): Promise<void> {
  // Fail closed: do not expose the payment-preparation API until the live
  // RPC, AgentPay bytecode, and configured USDC token have been verified.
  await verifyArcDeployment();
  server.listen(PORT, HOST, () => {
    console.log(`Orvynn agent API listening at http://${HOST}:${PORT}`);
    console.log("Arc Mainnet deployment verified; API only prepares and simulates payments.");
    console.log("POST /v1/payment-requests/prepare — never signs or submits.");
  });
}

start().catch((error: unknown) => {
  console.error("Agent API startup verification failed; server was not started:", error);
  process.exitCode = 1;
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
