// OWNED BY TRACK B. Dispatch guard, contractor choice, no-answer fallback and escalation.
import { callEvent, db, must, ticketEvent } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import { startDispatcherCall } from "@/lib/vapi";
import { TRADE_FOR_ISSUE, type Trade } from "@/lib/contract";
import { clock, formatWindow, localToday, startsInWindow } from "@/lib/time";
import { getTicket, type Contractor, type TicketFull } from "./data";

/** After this many contractor calls without a booking, a human takes over. */
export const MAX_DISPATCH_ATTEMPTS = 2;

export type DispatchResult =
  | { started: true; contractor: Contractor; callId: string }
  | { started: false; reason: string };

/** When the tenant is home. Both ends optional; ISO times. */
export interface Window {
  from: string | null;
  until: string | null;
}

/**
 * Turns the agent's "HH:MM" answers into a window for today. "until" earlier than "from"
 * (e.g. 22:00 to 00:30) runs past midnight. A start in the past means "from now".
 */
export function windowFrom(fromHHMM?: string, untilHHMM?: string): Window {
  const now = Date.now();
  let from = localToday(fromHHMM);
  let until = localToday(untilHHMM);
  if (from && from.getTime() < now) from = null;
  if (until && from && until <= from) until = new Date(until.getTime() + 86400e3);
  if (until && until.getTime() <= now) until = null;
  return { from: from?.toISOString() ?? null, until: until?.toISOString() ?? null };
}

interface FreeSlot {
  id: number;
  starts_at: string;
  ends_at: string;
}

async function pickContractor(trade: Trade, exclude: number[], win: Window) {
  const contractors = must(
    await db().from("contractors").select("id, name, company, trade, phone, rating, language").eq("trade", trade).order("rating", { ascending: false }),
    "contractors",
  ) as Contractor[];
  for (const c of contractors) {
    if (exclude.map(Number).includes(Number(c.id))) continue;
    const free = must(
      await db()
        .from("contractor_slots")
        .select("id, starts_at, ends_at")
        .eq("contractor_id", c.id)
        .eq("booked", false)
        .gt("starts_at", new Date().toISOString())
        .order("starts_at"),
      "slots",
    ) as FreeSlot[];
    // Only slots that overlap the time the tenant is home.
    const fits = free.filter((s) => startsInWindow(s.starts_at, win.from, win.until));
    if (fits.length) return { contractor: c, slots: fits.slice(0, 2) };
  }
  return null;
}

/** The earliest free slot of any contractor for the trade, ignoring the tenant's window. */
async function earliestSlot(trade: Trade, exclude: number[]) {
  const ids = (must(await db().from("contractors").select("id").eq("trade", trade), "contractors") as { id: number }[])
    .map((c) => Number(c.id))
    .filter((id) => !exclude.map(Number).includes(id));
  if (!ids.length) return null;
  const rows = must(
    await db()
      .from("contractor_slots")
      .select("id, starts_at, ends_at")
      .in("contractor_id", ids)
      .eq("booked", false)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(1),
    "earliest slot",
  ) as FreeSlot[];
  return rows[0] ?? null;
}

/**
 * The dispatch guard. Checks the ticket in the database before anything dials, so a
 * confused call can never ring a contractor's phone for nothing.
 */
export function guard(t: TicketFull | null): string | null {
  if (!t) return "No ticket with that number. Create the ticket first.";
  if (!t.issue_type || !t.urgency) return "The ticket has no issue type or urgency yet.";
  if (t.urgency === "emergency" || t.status === "escalated")
    return "This is an emergency. The on-call manager has been alerted and handles it, so no contractor is called automatically.";
  if (t.status === "dispatching") return "A contractor is already being called for this ticket.";
  if (t.status === "scheduled") return "A contractor is already booked for this ticket.";
  if (t.status === "resolved") return "This ticket is already resolved.";
  return null;
}

/** Calls the best-rated free contractor for the ticket. Used by the tool, the dashboard backup button and retries. */
export async function dispatchTicket(ticketId: number, opts: { retry?: boolean; window?: Window } = {}): Promise<DispatchResult> {
  const t = await getTicket(ticketId);
  if (!opts.retry) {
    const refusal = guard(t);
    if (refusal) return { started: false, reason: refusal };
  }
  if (!t) return { started: false, reason: "No ticket with that number." };

  // The trade always follows the ticket's issue type, whatever the agent asked for.
  const trade = TRADE_FOR_ISSUE[t.issue_type];
  // A new window from the agent wins; a retry reuses the one stored on the ticket.
  const win: Window = opts.window ?? { from: t.available_from ?? null, until: t.available_until ?? null };
  if (opts.window) {
    const { error } = await db().from("tickets").update({ available_from: win.from, available_until: win.until }).eq("id", t.id);
    if (error) console.error("storing the tenant's window failed (run supabase/migrations/002?)", error.message);
  }
  const pick = await pickContractor(trade, t.tried_contractor_ids ?? [], win);
  if (!pick && (win.from || win.until)) {
    // Nobody fits the tenant's window: offer the earliest time instead of escalating.
    const next = await earliestSlot(trade, t.tried_contractor_ids ?? []);
    if (next) {
      const lang = t.tenant?.language ?? "en";
      await ticketEvent(t.id, "window", `No ${trade} slot while the tenant is home (${formatWindow(win.from, win.until)}); earliest ${clock(next.starts_at)}`);
      return {
        started: false,
        reason: `No ${trade} has a slot while the tenant is home (${formatWindow(win.from, win.until)}). The earliest free time today is ${clock(next.starts_at, lang)} to ${clock(next.ends_at, lang)}. Ask the tenant if that works; if yes, call dispatch_contractor again with available_from ${clock(next.starts_at)}.`,
      };
    }
  }
  if (!pick) {
    await escalate(t, `No ${trade} with a free slot today.`);
    return { started: false, reason: `No ${trade} has a free slot today. The property manager has been asked to call the tenant back.` };
  }

  // Claim the ticket first (only if it's still open, or still dispatching for a retry) so two calls can't race.
  const claim = await db()
    .from("tickets")
    .update({
      status: "dispatching",
      contractor_id: pick.contractor.id,
      dispatch_attempts: (t.dispatch_attempts ?? 0) + 1,
      tried_contractor_ids: [...(t.tried_contractor_ids ?? []), pick.contractor.id],
    })
    .eq("id", t.id)
    .in("status", opts.retry ? ["dispatching"] : ["open"])
    .select("id");
  if (!must(claim, "claim ticket").length) return { started: false, reason: "This ticket is already being handled." };

  const visitFirst = t.visit_unit?.label ?? t.unit.label;
  try {
    const { callId } = await startDispatcherCall({
      ticketId: t.id,
      contractorName: pick.contractor.name,
      contractorPhone: pick.contractor.phone,
      language: pick.contractor.language,
      trade,
      building: t.unit.building.name,
      address: `${t.unit.building.address}, ${t.unit.building.city}`,
      unit: t.unit.label,
      visitFirst,
      urgency: t.urgency,
      issueSummary: t.summary,
      patternNote: t.pattern_note ?? "",
      tenantWindow: formatWindow(win.from, win.until, pick.contractor.language),
      slots: pick.slots.map((s) => ({ id: s.id, startsAt: s.starts_at, endsAt: s.ends_at })),
    });
    await db().from("tickets").update({ dispatcher_call_id: callId }).eq("id", t.id);
    await callEvent({ callId, agent: "dispatcher", role: "system", text: `Calling ${pick.contractor.name}…`, ticketId: t.id });
    await ticketEvent(
      t.id,
      "dispatch",
      `Calling ${pick.contractor.name} (${pick.contractor.company ?? trade}, ★${pick.contractor.rating})${win.from || win.until ? `, slots for the tenant's window ${formatWindow(win.from, win.until)}` : ""}${opts.retry ? " — previous contractor didn't book" : ""}`,
    );
    return { started: true, contractor: pick.contractor, callId };
  } catch (e) {
    console.error("startDispatcherCall failed", e);
    // Roll back so the ticket can be dispatched again (by the agent or the dashboard button).
    await db().from("tickets").update({ status: opts.retry ? "dispatching" : "open" }).eq("id", t.id);
    await ticketEvent(t.id, "dispatch", `Call to ${pick.contractor.name} failed to start`);
    return { started: false, reason: "The call to the contractor could not be started. A colleague will follow up." };
  }
}

/** Hands the ticket to a human: status escalated, on-call manager texted. */
export async function escalate(t: TicketFull, reason: string) {
  await db().from("tickets").update({ status: "escalated", escalation_reason: reason }).eq("id", t.id);
  await ticketEvent(t.id, "escalated", `Escalated to the on-call manager: ${reason}`);
  const manager = process.env.ONCALL_MANAGER_PHONE;
  if (manager) {
    const sms = await sendSms(
      manager,
      `Hausmeister: ticket #${t.id} needs you. ${t.unit.building.name} ${t.unit.label}, ${t.urgency} ${t.issue_type}: ${t.summary}. ${reason}`,
    );
    await ticketEvent(t.id, "sms", sms.sent ? "On-call manager texted" : "On-call manager SMS failed");
  }
}

/**
 * Called by the webhook when a dispatcher call ends. If the contractor didn't book
 * (no answer, voicemail, declined), try the next contractor by rating; after
 * MAX_DISPATCH_ATTEMPTS calls a human takes over.
 */
export async function onDispatcherCallEnded(t: TicketFull, endedReason: string) {
  if (t.status !== "dispatching") return; // booked (or handled) during the call
  await ticketEvent(t.id, "dispatch", `${t.contractor?.name ?? "Contractor"} didn't book (${endedReason})`);
  if ((t.dispatch_attempts ?? 0) >= MAX_DISPATCH_ATTEMPTS) {
    await escalate(t, `No contractor booked after ${t.dispatch_attempts} calls.`);
    if (t.tenant) {
      await sendSms(
        t.tenant.phone,
        t.tenant.language === "de"
          ? `Hausmeister: Wir suchen noch einen Handwerker für Ticket #${t.id}. Die Hausverwaltung ruft Sie gleich an.`
          : `Hausmeister: We're still finding a contractor for ticket #${t.id}. The property manager will call you shortly.`,
      );
    }
    return;
  }
  await dispatchTicket(t.id, { retry: true });
}
