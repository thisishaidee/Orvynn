import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/agent/payment-requests/prepare.js";

const token = "test-agent-token";
const env = { AGENT_API_TOKEN: token };

function request(body: string, authorization?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://orvynn.test/api/agent/payment-requests/prepare", {
    method: "POST",
    headers,
    body
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("returns 503 when the Agent API token is not configured", async () => {
  const response = await onRequestPost({
    request: request("{}"),
    env: {}
  });
  assert.equal(response.status, 503);
  assert.match(String((await responseBody(response)).error), /not configured/i);
});

test("rejects a missing bearer token before parsing the request body", async () => {
  const response = await onRequestPost({
    request: request("not-json"),
    env
  });
  assert.equal(response.status, 401);
  assert.match(String((await responseBody(response)).error), /token/i);
});

test("rejects an invalid bearer token", async () => {
  const response = await onRequestPost({
    request: request("{}", "Bearer wrong-token"),
    env
  });
  assert.equal(response.status, 401);
});

test("returns 400 for malformed JSON after successful authentication", async () => {
  const response = await onRequestPost({
    request: request("{invalid-json", `Bearer ${token}`),
    env
  });
  assert.equal(response.status, 400);
  assert.match(String((await responseBody(response)).error), /valid JSON/i);
});

test("returns 400 when the request body is missing", async () => {
  const req = new Request("https://orvynn.test/api/agent/payment-requests/prepare", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  const response = await onRequestPost({ request: req, env });
  assert.equal(response.status, 400);
  assert.match(String((await responseBody(response)).error), /body is required/i);
});

test("returns 400 when the request body exceeds 16 KB", async () => {
  const response = await onRequestPost({
    request: request(JSON.stringify({ payload: "x".repeat(16 * 1024) }), `Bearer ${token}`),
    env
  });
  assert.equal(response.status, 400);
  assert.match(String((await responseBody(response)).error), /16 KB limit/i);
});
