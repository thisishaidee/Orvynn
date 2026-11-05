interface Env {
  AGENT_API_TOKEN?: string;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export const onRequestGet = async ({ env }: { env: Env }) => {
  const tokenType = typeof env.AGENT_API_TOKEN;
  const tokenNonEmpty = tokenType === "string" && env.AGENT_API_TOKEN!.length > 0;

  return json({
    ok: true,
    service: "orvynn-agent",
    mode: "payment-preparation-only",
    chainId: 5042,
    agentApiConfigured: tokenNonEmpty,
    diagnostics: {
      tokenBindingPresent: Object.prototype.hasOwnProperty.call(env, "AGENT_API_TOKEN"),
      tokenValueType: tokenType,
      tokenNonEmpty
    }
  });
};
