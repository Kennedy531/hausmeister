// Vapi server URL for both agents. Every tool call from the tenant agent and the
// dispatcher agent lands here and is routed to Track B's handlers in src/lib/tools.
//
// Vapi rules this follows (docs.vapi.ai, checked 2026-11-20):
// - Always answer HTTP 200, or the agent says "no result returned".
// - Return { results: [{ toolCallId, result }] } with result as a flat string,
//   or { toolCallId, error } on failure.
// - Auth arrives as "X-Vapi-Secret: <secret>" or "Authorization: Bearer <secret>",
//   depending on how the credential is set up in Vapi. Both are accepted.
//   Vapi only sends it when the server URL is saved on the assistant or phone number,
//   not when it is passed inline in a POST /call.
import { timingSafeEqual } from "node:crypto";
import { tools } from "@/lib/tools";
import type { ToolContext } from "@/lib/tools/types";
import { isToolName, validateArgs } from "./validate";

interface VapiToolCall {
  id: string;
  function?: { name?: string; arguments?: unknown };
}

interface VapiMessage {
  type?: string;
  timestamp?: number;
  customer?: { number?: string };
  call?: { id?: string; startedAt?: string; createdAt?: string; customer?: { number?: string } };
  toolCallList?: VapiToolCall[];
}

type ToolResult = { toolCallId: string; name?: string; result: string } | { toolCallId: string; name?: string; error: string };

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** null when the request may proceed, otherwise the reason it is rejected. */
function authProblem(request: Request): string | null {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") return "VAPI_WEBHOOK_SECRET is not set";
    console.warn("[vapi] VAPI_WEBHOOK_SECRET not set: accepting unauthenticated requests (dev only)");
    return null;
  }
  const header = request.headers.get("x-vapi-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const given = header ?? bearer;
  return given && sameSecret(given, secret) ? null : "bad or missing secret";
}

function contextFrom(message: VapiMessage): ToolContext {
  const callStartedAt =
    message.call?.startedAt ??
    message.call?.createdAt ??
    (message.timestamp ? new Date(message.timestamp).toISOString() : null);
  return {
    // Inbound: the tenant. Outbound (dispatcher): the contractor.
    callerPhone: message.customer?.number ?? message.call?.customer?.number ?? null,
    callId: message.call?.id ?? null,
    callStartedAt,
  };
}

async function runToolCall(call: VapiToolCall, ctx: ToolContext): Promise<ToolResult> {
  const name = call.function?.name;
  const started = Date.now();
  if (!isToolName(name)) {
    return { toolCallId: call.id, name, error: `Unknown tool: ${name}` };
  }

  const checked = validateArgs(name, call.function?.arguments);
  if (!checked.ok) {
    console.warn(`[vapi] ${name} rejected: ${checked.error}`);
    return { toolCallId: call.id, name, error: checked.error };
  }

  try {
    // The validator guarantees the shape the contract expects for this tool.
    const handler = tools[name] as (input: unknown, ctx: ToolContext) => Promise<unknown>;
    const output = await handler(checked.args, ctx);
    console.log(`[vapi] ${name} ok in ${Date.now() - started}ms`);
    return { toolCallId: call.id, name, result: JSON.stringify(output) };
  } catch (err) {
    console.error(`[vapi] ${name} failed after ${Date.now() - started}ms`, err);
    return {
      toolCallId: call.id,
      name,
      error: `${name} failed on our side. Apologise briefly and tell the caller a human will follow up.`,
    };
  }
}

export async function POST(request: Request) {
  const problem = authProblem(request);
  if (problem) {
    console.warn(`[vapi] rejected request: ${problem}`);
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let message: VapiMessage;
  try {
    const body = (await request.json()) as { message?: VapiMessage };
    message = body.message ?? {};
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Status updates, transcripts, end-of-call reports: acknowledge and ignore for now.
  if (message.type !== "tool-calls") {
    return Response.json({});
  }

  const ctx = contextFrom(message);
  const calls = message.toolCallList ?? [];
  const results = await Promise.all(calls.map((call) => runToolCall(call, ctx)));
  return Response.json({ results });
}

/** Health check: open /api/vapi in a browser to confirm the deploy or tunnel is live. */
export function GET() {
  return Response.json({ ok: true, service: "hausmeister vapi webhook" });
}
