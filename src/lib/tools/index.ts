// OWNED BY TRACK B. Track A calls `tools[name](input, ctx)` from the Vapi webhook.
// Every handler returns contract-shaped data (src/lib/contract.ts) and never throws
// for an expected refusal: it returns a reason the agent can say instead.
import type { ToolHandlers } from "./types";
import { TRADE_FOR_ISSUE, type IssueType, type Urgency } from "@/lib/contract";
import { db, must, ticketEvent } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import { bookingEmail, sendEmail, tenantEmailAddress } from "@/lib/email";
import { formatSlot, formatWindow, startsInWindow } from "@/lib/time";
import {
  buildingContext,
  cleanUnitLabel,
  findTenantByPhone,
  findUnit,
  getTicket,
  getTicketByCall,
  patternNote,
} from "./data";
import { dispatchTicket, escalate, windowFrom } from "./dispatch";
import { notifyNeighbour } from "./neighbour";

const ISSUES: IssueType[] = ["leak", "heating", "electrical", "lock", "appliance", "pest", "other"];
const URGENCIES: Urgency[] = ["emergency", "urgent", "normal"];

function asIssue(v: unknown): IssueType {
  return ISSUES.includes(v as IssueType) ? (v as IssueType) : "other";
}
function asUrgency(v: unknown): Urgency {
  return URGENCIES.includes(v as Urgency) ? (v as Urgency) : "normal";
}
function asId(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export const tools: ToolHandlers = {
  async lookup_tenant(_input, ctx) {
    const t = await findTenantByPhone(ctx.callerPhone);
    if (!t) {
      return { found: false, message: "Caller's number is not on file. Ask for their name and apartment number." };
    }
    return { found: true, tenant_name: t.name, unit: t.unit.label, building: t.unit.building.name, language: t.language };
  },

  async get_building_context(input, ctx) {
    const issue = asIssue(input.issue_type);
    let unit = cleanUnitLabel(input.unit);
    if (!unit) unit = (await findTenantByPhone(ctx.callerPhone))?.unit.label ?? "";
    const c = await buildingContext(unit, issue);
    const tenant = await findTenantByPhone(ctx.callerPhone);
    return {
      similar_recent: c.similar_recent.map(({ unit, issue_type, summary, days_ago }) => ({ unit, issue_type, summary, days_ago })),
      pattern: c.pattern,
      pattern_note: patternNote(c, issue, TRADE_FOR_ISSUE[issue], tenant?.language ?? "en"),
      visit_first: c.visit_first ?? unit,
    };
  },

  async create_ticket(input, ctx) {
    // One ticket per tenant call: if the agent calls this twice, return the same ticket.
    if (ctx.callId) {
      const existing = await getTicketByCall("tenant_call_id", ctx.callId);
      if (existing) {
        return { ticket_id: existing.id, pattern: existing.pattern_flag, visit_first: existing.visit_unit?.label ?? existing.unit.label };
      }
    }
    const tenant = await findTenantByPhone(ctx.callerPhone);
    const unit = (await findUnit(input.unit)) ?? (tenant ? await findUnit(tenant.unit.label) : null);
    if (!unit) throw new Error(`Unknown apartment "${input.unit}". Ask the tenant for their apartment number.`);

    const issue = asIssue(input.issue_type);
    const urgency = asUrgency(input.urgency);
    const c = await buildingContext(unit.label, issue);
    const note = patternNote(c, issue, TRADE_FOR_ISSUE[issue], tenant?.language ?? "en");
    const visit = c.visit_first ? await findUnit(c.visit_first) : unit;

    const row = must(
      await db()
        .from("tickets")
        .insert({
          unit_id: unit.id,
          tenant_id: tenant && tenant.unit.id === unit.id ? tenant.id : null,
          issue_type: issue,
          urgency,
          status: urgency === "emergency" ? "escalated" : "open",
          summary: String(input.summary || "No summary given").slice(0, 500),
          pattern_flag: c.pattern,
          pattern_note: note || null,
          visit_unit_id: visit?.id ?? unit.id,
          tenant_call_id: ctx.callId,
          call_started_at: ctx.callStartedAt ?? new Date().toISOString(),
        })
        .select("id")
        .single(),
      "create ticket",
    ) as { id: number };

    await ticketEvent(row.id, "created", `Ticket created: ${urgency} ${issue} in ${unit.label} — ${input.summary}`);
    if (c.pattern) {
      await ticketEvent(
        row.id,
        "pattern",
        `Pattern: ${c.similar_recent.length + 1} ${issue} reports in stack ${unit.stack} within 30 days (${[unit.label, ...c.similar_recent.map((s) => s.unit)].join(", ")}). Visit ${c.visit_first} first.`,
      );
    }
    if (ctx.callId) await db().from("call_events").update({ ticket_id: row.id }).eq("call_id", ctx.callId);

    if (urgency === "emergency") {
      const t = await getTicket(row.id);
      if (t) await escalate(t, "Emergency reported on the phone. Tenant was given the safety script and told to call 112.");
    }
    return { ticket_id: row.id, pattern: c.pattern, visit_first: c.visit_first ?? unit.label };
  },

  async dispatch_contractor(input) {
    const hasWindow = Boolean(input.available_from || input.available_until);
    const r = await dispatchTicket(asId(input.ticket_id), {
      window: hasWindow ? windowFrom(input.available_from, input.available_until) : undefined,
    });
    if (!r.started) return { started: false, contractor_name: "", message: r.reason };
    return {
      started: true,
      contractor_name: r.contractor.name,
      message: `Calling ${r.contractor.name} the ${r.contractor.trade} now. The tenant gets a text with the time once it's booked.`,
    };
  },

  async confirm_slot(input) {
    const ticketId = asId(input.ticket_id);
    // Never book a time the tenant said they're not home, even if the slot is free.
    const before = await getTicket(ticketId);
    if (before && (before.available_from || before.available_until)) {
      const slot = must(
        await db().from("contractor_slots").select("starts_at, ends_at").eq("id", asId(input.slot_id)).maybeSingle(),
        "slot",
      ) as { starts_at: string; ends_at: string } | null;
      const fits = slot && startsInWindow(slot.starts_at, before.available_from, before.available_until);
      if (slot && !fits) {
        return {
          confirmed: false,
          scheduled_at: "",
          tenant_sms_sent: false,
          message: `The tenant isn't home then (${formatWindow(before.available_from ?? null, before.available_until ?? null)}). Offer only the listed slots.`,
        };
      }
    }
    const res = must(
      await db().rpc("book_slot", { p_ticket: ticketId, p_slot: asId(input.slot_id) }),
      "book slot",
    ) as { ok: boolean; reason?: string; already_booked?: boolean; scheduled_at?: string; ends_at?: string };

    if (!res.ok) {
      if (res.already_booked && res.scheduled_at) {
        return { confirmed: true, scheduled_at: res.scheduled_at, tenant_sms_sent: true, message: "Already booked, the tenant has been texted." };
      }
      return { confirmed: false, scheduled_at: "", tenant_sms_sent: false, message: res.reason ?? "Could not book that slot." };
    }

    const t = await getTicket(ticketId);
    const name = t?.contractor?.name ?? "The contractor";
    const company = t?.contractor?.company ? ` (${t.contractor.company})` : "";
    const lang = t?.tenant?.language ?? "en";
    const when = formatSlot(res.scheduled_at!, res.ends_at!, lang);
    const visitFirst = t?.visit_unit?.label;
    const firstNote =
      visitFirst && t && visitFirst !== t.unit.label
        ? lang === "de"
          ? ` Zuerst schaut er in ${visitFirst} nach der Ursache.`
          : lang === "nl"
            ? ` Eerst kijkt hij in ${visitFirst} naar de oorzaak.`
            : ` They'll check ${visitFirst} first for the source.`
        : "";
    await ticketEvent(ticketId, "booked", `${name} booked for ${formatSlot(res.scheduled_at!, res.ends_at!, "en")}`);

    let smsSent = false;
    if (t?.tenant) {
      const body =
        lang === "de"
          ? `Hausmeister: ${name}${company} kommt ${when} zu Ihnen (Ticket #${ticketId}).${firstNote}`
          : lang === "nl"
            ? `Hausmeister: ${name}${company} komt ${when} naar uw woning ${t.unit.label} (ticket #${ticketId}).${firstNote}`
            : `Hausmeister: ${name}${company} is booked for ${when} at your flat ${t.unit.label} (ticket #${ticketId}).${firstNote}`;
      const sms = await sendSms(t.tenant.phone, body);
      smsSent = sms.sent;
      await ticketEvent(ticketId, "sms", sms.sent ? `Tenant texted: "${body}"` : `Tenant SMS not sent (${sms.error}): "${body}"`);
    }

    // Email confirmation with all the details (works where the SMS trial doesn't).
    let emailSent = false;
    const to = tenantEmailAddress();
    if (t && to) {
      const mail = bookingEmail({
        ticketId,
        tenantName: t.tenant?.name?.split(" ")[0] ?? "there",
        unit: t.unit.label,
        building: t.unit.building.name,
        address: `${t.unit.building.address}, ${t.unit.building.city}`,
        issueSummary: t.summary,
        urgency: t.urgency,
        contractorName: name,
        contractorCompany: t.contractor?.company ?? null,
        trade: t.contractor?.trade ?? "contractor",
        when: formatSlot(res.scheduled_at!, res.ends_at!, "en"),
        visitFirst: visitFirst ?? null,
        patternNote: t.pattern_flag ? t.pattern_note : null,
      });
      const r = await sendEmail({ to, ...mail });
      emailSent = r.sent;
      await ticketEvent(ticketId, "email", r.sent ? `Tenant emailed: "${mail.subject}"` : `Tenant email not sent (${r.error})`);
    }
    if (t) await notifyNeighbour(t, res.scheduled_at!, res.ends_at!);
    return {
      confirmed: true,
      scheduled_at: res.scheduled_at!,
      tenant_sms_sent: smsSent || emailSent,
      message: `Booked for ${formatSlot(res.scheduled_at!, res.ends_at!, t?.contractor?.language ?? "en")}. Thank the contractor and end the call.`,
    };
  },
};
