// OWNED BY TRACK A. Track B calls startDispatcherCall() from the dispatch_contractor tool.
import type { Language, Trade, Urgency } from "@/lib/contract";

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

/**
 * Starts the outbound dispatcher call to the contractor.
 * STUB: logs only. Track A replaces this with a Vapi POST /call using
 * VAPI_DISPATCHER_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID, passing the brief as variable values.
 */
export async function startDispatcherCall(brief: DispatcherBrief): Promise<{ callId: string }> {
  console.log("[stub] startDispatcherCall", brief);
  return { callId: `stub-${brief.ticketId}` };
}
