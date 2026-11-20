// OWNED BY TRACK A. Track B calls startDispatcherCall() from the dispatch_contractor tool.
import type { Language, Trade, Urgency } from "@/lib/contract";
import { formatSlot } from "@/lib/time";

/** Everything the dispatcher agent needs to brief the contractor. Shared seam: agree before changing. */
export interface DispatcherBrief {
  ticketId: number;
  contractorName: string;
  contractorPhone: string; // E.164
  language: Language;
  trade: Trade;
  building: string;
  address: string;
  unit: string; // unit that reported the issue
  visitFirst: string; // unit to visit first (pattern rule)
  urgency: Urgency;
  issueSummary: string;
  patternNote: string; // empty when there is no pattern
  slots: { id: number; startsAt: string; endsAt: string }[];
}

const VAPI_API = "https://api.vapi.ai";

/** The dispatcher prompt reads these as {{ variables }} (see agents/dispatcher/prompt.md). */
export function dispatcherVariables(brief: DispatcherBrief): Record<string, string> {
  const lang = brief.language;
  return {
    agent: "dispatcher",
    ticket_id: String(brief.ticketId),
    contractor_name: brief.contractorName,
    language: lang,
    trade: brief.trade,
    building: brief.building,
    address: brief.address,
    unit: brief.unit,
    visit_first: brief.visitFirst,
    urgency: brief.urgency,
    issue_summary: brief.issueSummary,
    pattern_note: brief.patternNote || "none",
    // Times are spoken in the venue's time zone, never UTC.
    slots_text: brief.slots
      .map((s) => `slot_id ${s.id}: ${formatSlot(s.startsAt, s.endsAt, lang)}`)
      .join("; "),
  };
}

/**
 * Starts the outbound dispatcher call to the contractor with Vapi POST /call.
 * Uses VAPI_DISPATCHER_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID; the brief goes in as variable values.
 * Without VAPI_API_KEY it only logs (dry run), so the loop can be simulated without phones.
 */
export async function startDispatcherCall(brief: DispatcherBrief): Promise<{ callId: string }> {
  const key = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_DISPATCHER_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!key || !assistantId || !phoneNumberId) {
    console.log("[vapi dry run] would call", brief.contractorName, brief.contractorPhone, dispatcherVariables(brief));
    return { callId: `dryrun-${brief.ticketId}-${Date.now()}` };
  }
  const res = await fetch(`${VAPI_API}/call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      assistantId,
      phoneNumberId,
      customer: { number: brief.contractorPhone, name: brief.contractorName },
      assistantOverrides: { variableValues: dispatcherVariables(brief) },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vapi POST /call ${res.status}: ${text}`);
  const call = JSON.parse(text) as { id: string };
  return { callId: call.id };
}
