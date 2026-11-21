/**
 * Tool contract shared by the voice agents (Vapi), the backend and the dashboard.
 *
 * The tenant agent and the dispatcher agent call these tools through one
 * webhook. Each tool's input is what the agent sends as the function
 * arguments; each output is what the agent gets back and speaks from.
 * Change a shape here first, then update the agent tool definitions.
 */

export type IssueType =
  | "leak"
  | "heating"
  | "electrical"
  | "lock"
  | "appliance"
  | "pest"
  | "other";

export type Urgency = "emergency" | "urgent" | "normal";

export type Trade = "plumber" | "electrician" | "locksmith" | "handyman";

export type TicketStatus =
  | "open"
  | "dispatching"
  | "scheduled"
  | "escalated"
  | "resolved";

export type Language = "en" | "de" | "nl";

/** Which trade fixes which kind of issue. */
export const TRADE_FOR_ISSUE: Record<IssueType, Trade> = {
  leak: "plumber",
  heating: "plumber",
  electrical: "electrician",
  lock: "locksmith",
  appliance: "handyman",
  pest: "handyman",
  other: "handyman",
};

// ---------------------------------------------------------------------------
// lookup_tenant: tenant agent, at call start.
// The caller's number is read from the call itself, so the agent sends nothing.
// ---------------------------------------------------------------------------
export type LookupTenantInput = Record<string, never>;
export type LookupTenantOutput =
  | {
      found: true;
      tenant_name: string;
      unit: string; // e.g. "3B"
      building: string; // e.g. "Building B"
      language: Language;
    }
  | { found: false; message: string };

// ---------------------------------------------------------------------------
// get_building_context: tenant agent, after triage.
// ---------------------------------------------------------------------------
export interface GetBuildingContextInput {
  unit: string;
  issue_type: IssueType;
}
export interface GetBuildingContextOutput {
  similar_recent: { unit: string; issue_type: IssueType; summary: string; days_ago: number }[];
  pattern: boolean;
  /** One sentence the agent can say about the pattern, empty when there is none. */
  pattern_note: string;
  /** The unit the contractor should visit first (highest affected unit in the stack). */
  visit_first: string;
}

// ---------------------------------------------------------------------------
// create_ticket: tenant agent.
// ---------------------------------------------------------------------------
export interface CreateTicketInput {
  unit: string;
  issue_type: IssueType;
  urgency: Urgency;
  summary: string;
}
export interface CreateTicketOutput {
  ticket_id: number;
  pattern: boolean;
  visit_first: string;
}

// ---------------------------------------------------------------------------
// dispatch_contractor: tenant agent. Starts the outbound dispatcher call.
// ---------------------------------------------------------------------------
export interface DispatchContractorInput {
  ticket_id: number;
  trade: Trade;
  /** "When are you home today?" as local 24-hour times, e.g. "18:00". Leave out for "any time". */
  available_from?: string;
  available_until?: string;
}
export interface DispatchContractorOutput {
  started: boolean;
  contractor_name: string;
  message: string;
}

// ---------------------------------------------------------------------------
// confirm_slot: dispatcher agent, once the contractor accepts a slot.
// ---------------------------------------------------------------------------
export interface ConfirmSlotInput {
  ticket_id: number;
  /** One of the slot ids the dispatcher was briefed with. */
  slot_id: number;
}
export interface ConfirmSlotOutput {
  confirmed: boolean;
  scheduled_at: string; // ISO time
  tenant_sms_sent: boolean;
  message: string;
}

/** Every tool name, mapped to its input and output types. */
export interface ToolContract {
  lookup_tenant: { input: LookupTenantInput; output: LookupTenantOutput };
  get_building_context: { input: GetBuildingContextInput; output: GetBuildingContextOutput };
  create_ticket: { input: CreateTicketInput; output: CreateTicketOutput };
  dispatch_contractor: { input: DispatchContractorInput; output: DispatchContractorOutput };
  confirm_slot: { input: ConfirmSlotInput; output: ConfirmSlotOutput };
}

export type ToolName = keyof ToolContract;
