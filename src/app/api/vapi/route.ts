// OWNED BY TRACK A. The one webhook Vapi calls for both agents.
//
// Handles:
//   assistant-request   inbound call on a number with no fixed assistant: look up the caller
//                       and start the tenant agent with their name and unit already known
//   tool-calls          run tools[name](args, ctx) and return { results: [...] }
//   transcript          final lines only, written to call_events for the dashboard panel
//   status-update       "connected" / "ended" lines for the transcript panel
//   end-of-call-report  dispatcher call ended without a booking -> next contractor / escalate
import { after, type NextRequest } from "next/server";
import { tools } from "@/lib/tools";
import type { ToolContext } from "@/lib/tools/types";
import type { ToolName } from "@/lib/contract";
import { callEvent, db, ticketEvent } from "@/lib/db";
import { translateLine } from "@/lib/openai";
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

/** A short human line for the transcript panel, instead of raw JSON. */
function describe(name: string, out: unknown): string {
  const o = (out ?? {}) as Record<string, unknown>;
  switch (name) {
    case "lookup_tenant":
      return o.found ? `Caller ID matched ${o.tenant_name}, apartment ${o.unit}` : "Caller ID not on file";
    case "create_ticket":
      return `Ticket #${o.ticket_id} created`;
    case "get_building_context": {
      const n = Array.isArray(o.similar_recent) ? o.similar_recent.length : 0;
      return o.pattern ? `Pattern found: ${n} similar reports in the stack, visit ${o.visit_first} first` : "No pattern in the building history";
    }
    case "dispatch_contractor":
      return o.started ? `Calling ${o.contractor_name}` : `Not dispatched: ${short(String(o.message ?? "").split(". ")[0], 90)}`;
    case "confirm_slot":
      return o.confirmed ? `Slot booked${o.tenant_sms_sent ? ", tenant emailed" : ""}` : `Not booked: ${short(o.message, 90)}`;
    default:
      return short(out);
  }
}

async function subtitle(id: number, text: string) {
  try {
    const t = await translateLine(text);
    if (t) await db().from("call_events").update({ lang: t.lang, translation: t.english }).eq("id", id);
  } catch (e) {
    console.error("translation failed", e);
  }
}

/** Stores what the call cost (Vapi reports it in USD) on the ticket, for the dashboard's impact card. */
async function recordCost(callId: string, agent: Agent, cost: number) {
  if (!Number.isFinite(cost) || cost <= 0) return;
  let ticketId: number | null = null;
  if (agent === "tenant") ticketId = (await getTicketByCall("tenant_call_id", callId))?.id ?? null;
  if (!ticketId) {
    const { data } = await db().from("call_events").select("ticket_id").eq("call_id", callId).not("ticket_id", "is", null).limit(1);
    ticketId = (data as { ticket_id: number }[] | null)?.[0]?.ticket_id ?? null;
  }
  if (!ticketId && agent === "dispatcher") ticketId = (await getTicketByCall("dispatcher_call_id", callId))?.id ?? null;
  if (ticketId) await ticketEvent(ticketId, "cost", `${agent} ${cost.toFixed(4)}`);
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
      if (ctx.callId) await callEvent({ callId: ctx.callId, agent, role: "tool", text: `${name} → ${describe(name, out)}` });
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
        const id = await callEvent({ callId: call.id, agent, role, text });
        // Live subtitles: translate after the response is sent, so Vapi is never kept waiting.
        if (id) after(() => subtitle(id, text));
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

    if (type === "end-of-call-report" && call.id) {
      await recordCost(call.id, agent, Number(msg.cost ?? (call as { cost?: number }).cost ?? NaN));
      if (agent === "dispatcher") {
        const t = await getTicketByCall("dispatcher_call_id", call.id);
        if (t) await onDispatcherCallEnded(t, String(msg.endedReason ?? "call ended"));
      }
      return Response.json({});
    }
  } catch (e) {
    console.error(`webhook ${type} failed`, e);
    // Vapi ignores non-200 responses; tool errors are already returned per call above.
    return Response.json({});
  }

  return Response.json({});
}
