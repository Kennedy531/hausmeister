// OWNED BY TRACK A. The one webhook Vapi calls for both agents.
//
// Handles:
//   assistant-request   inbound call on a number with no fixed assistant: look up the caller
//                       and start the tenant agent with their name and unit already known
//   tool-calls          run tools[name](args, ctx) and return { results: [...] }
//   transcript          final lines only, written to call_events for the dashboard panel
//   status-update       "connected" / "ended" lines for the transcript panel
//   end-of-call-report  dispatcher call ended without a booking -> next contractor / escalate
import type { NextRequest } from "next/server";
import { tools } from "@/lib/tools";
import type { ToolContext } from "@/lib/tools/types";
import type { ToolName } from "@/lib/contract";
import { callEvent } from "@/lib/db";
import { findTenantByPhone, getTicketByCall } from "@/lib/tools/data";
import { onDispatcherCallEnded } from "@/lib/tools/dispatch";

type Json = Record<string, unknown>;
type Agent = "tenant" | "dispatcher";

interface VapiCall {
  id?: string;
  assistantId?: string;
  createdAt?: string;
  startedAt?: string;
  customer?: { number?: string };
  assistantOverrides?: { variableValues?: Record<string, string> };
}

function authorised(req: NextRequest): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    // Without a secret anyone could make the backend phone a contractor, so production refuses.
    if (process.env.NODE_ENV === "production") return false;
    console.warn("VAPI_WEBHOOK_SECRET is not set: accepting webhook without auth (dev only)");
    return true;
  }
  const header = req.headers.get("x-vapi-secret");
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === secret || bearer === secret;
}

function agentOf(msg: Json, call: VapiCall): Agent {
  const dispatcherId = process.env.VAPI_DISPATCHER_ASSISTANT_ID;
  const assistant = msg.assistant as { id?: string; name?: string } | undefined;
  if (call.assistantOverrides?.variableValues?.agent === "dispatcher") return "dispatcher";
  if (dispatcherId && (call.assistantId === dispatcherId || assistant?.id === dispatcherId)) return "dispatcher";
  if (assistant?.name?.toLowerCase().includes("dispatcher")) return "dispatcher";
  return "tenant";
}

function contextOf(msg: Json, call: VapiCall): ToolContext {
  const customer = (msg.customer as { number?: string } | undefined) ?? call.customer;
  return {
    callerPhone: customer?.number ?? call.customer?.number ?? null,
    callId: call.id ?? null,
    callStartedAt: call.startedAt ?? call.createdAt ?? null,
  };
}

function short(v: unknown, max = 140): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function handleAssistantRequest(msg: Json, call: VapiCall) {
  const assistantId = process.env.VAPI_TENANT_ASSISTANT_ID;
  if (!assistantId) return { error: "The caretaker line is not configured yet." };
  const ctx = contextOf(msg, call);
  let variableValues: Record<string, string> = { agent: "tenant", tenant_known: "no" };
  try {
    const t = await findTenantByPhone(ctx.callerPhone);
    if (t) {
      const first = t.name.split(" ")[0];
      variableValues = {
        agent: "tenant",
        tenant_known: "yes",
        tenant_name: t.name,
        unit: t.unit.label,
        building: t.unit.building.name,
        language: t.language,
        first_message:
          t.language === "de"
            ? `Hallo ${first}, hier ist Hausmeister. Geht es um Wohnung ${t.unit.label} in ${t.unit.building.name}?`
            : `Hi ${first}, this is Hausmeister. Is this about apartment ${t.unit.label} in ${t.unit.building.name}?`,
      };
    }
  } catch (e) {
    console.error("assistant-request lookup failed", e);
  }
  if (call.id) {
    await callEvent({
      callId: call.id,
      agent: "tenant",
      role: "system",
      text: variableValues.tenant_known === "yes"
        ? `Incoming call · caller ID matched ${variableValues.tenant_name}, ${variableValues.unit}`
        : "Incoming call · caller ID not on file",
    });
  }
  return { assistantId, assistantOverrides: { variableValues } };
}

async function handleToolCalls(msg: Json, call: VapiCall, agent: Agent) {
  const ctx = contextOf(msg, call);
  const list = (msg.toolCallList ?? msg.toolCalls ?? []) as {
    id: string;
    name?: string;
    arguments?: unknown;
    function?: { name?: string; arguments?: unknown };
  }[];
  const results: { toolCallId: string; name: string; result?: string; error?: string }[] = [];

  for (const tc of list) {
    const name = (tc.function?.name ?? tc.name ?? "") as ToolName;
    let args = tc.function?.arguments ?? tc.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args || "{}");
      } catch {
        args = {};
      }
    }
    const handler = tools[name] as ((i: unknown, c: ToolContext) => Promise<unknown>) | undefined;
    if (!handler) {
      results.push({ toolCallId: tc.id, name, error: `Unknown tool ${name}` });
      continue;
    }
    try {
      const out = await handler(args, ctx);
      results.push({ toolCallId: tc.id, name, result: JSON.stringify(out) });
      if (ctx.callId) await callEvent({ callId: ctx.callId, agent, role: "tool", text: `${name} → ${short(out)}` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`tool ${name} failed`, e);
      results.push({ toolCallId: tc.id, name, error: message });
      if (ctx.callId) await callEvent({ callId: ctx.callId, agent, role: "tool", text: `${name} ✗ ${short(message)}` });
    }
  }
  return { results };
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return Response.json({ error: "unauthorised" }, { status: 401 });

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const msg = (body.message ?? body) as Json;
  const type = String(msg.type ?? "");
  const call = (msg.call ?? {}) as VapiCall;
  const agent = agentOf(msg, call);

  try {
    if (type === "assistant-request") return Response.json(await handleAssistantRequest(msg, call));

    if (type === "tool-calls") return Response.json(await handleToolCalls(msg, call, agent));

    if (type.startsWith("transcript")) {
      const final = msg.transcriptType === "final" || type.includes("final");
      const text = String(msg.transcript ?? "").trim();
      if (final && text && call.id) {
        const role = msg.role === "user" ? "user" : "assistant";
        await callEvent({ callId: call.id, agent, role, text });
      }
      return Response.json({});
    }

    if (type === "status-update" && call.id) {
      const status = String(msg.status ?? "");
      if (status === "in-progress") {
        await callEvent({ callId: call.id, agent, role: "system", text: agent === "dispatcher" ? "Contractor picked up" : "Call connected" });
      } else if (status === "ringing" && agent === "dispatcher") {
        await callEvent({ callId: call.id, agent, role: "system", text: "Ringing the contractor…" });
      } else if (status === "ended") {
        await callEvent({ callId: call.id, agent, role: "system", text: "Call ended" });
      }
      return Response.json({});
    }

    if (type === "end-of-call-report" && call.id && agent === "dispatcher") {
      const t = await getTicketByCall("dispatcher_call_id", call.id);
      if (t) await onDispatcherCallEnded(t, String(msg.endedReason ?? "call ended"));
      return Response.json({});
    }
  } catch (e) {
    console.error(`webhook ${type} failed`, e);
    // Vapi ignores non-200 responses; tool errors are already returned per call above.
    return Response.json({});
  }

  return Response.json({});
}
