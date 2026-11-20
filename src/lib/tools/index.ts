// OWNED BY TRACK B. Track A calls `tools[name](input, ctx)` from the Vapi webhook.
// Every handler returns contract-shaped data (src/lib/contract.ts) and never throws
// for an expected refusal: it returns a reason the agent can say instead.
import type { ToolHandlers } from "./types";
import { TRADE_FOR_ISSUE, type IssueType, type Urgency } from "@/lib/contract";
import { db, must, ticketEvent } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import { formatSlot } from "@/lib/time";
import {
  buildingContext,
  cleanUnitLabel,
  findTenantByPhone,
  findUnit,
  getTicket,
  getTicketByCall,
  patternNote,
} from "./data";
import { dispatchTicket, escalate } from "./dispatch";

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

  async send_photo_link(input, ctx) {
    const t = await getTicket(asId(input.ticket_id));
    if (!t) return { sent: false, message: "No ticket with that number." };
    const to = t.tenant?.phone ?? ctx.callerPhone;
    if (!to) return { sent: false, message: "No phone number to text." };
    const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const lang = t.tenant?.language ?? "en";
    const link = `${base}/photo/${t.id}`;
    const sms = await sendSms(
      to,
      lang === "de"
        ? `Hausmeister: Bitte schicken Sie ein Foto vom Schaden (Ticket #${t.id}): ${link}`
        : `Hausmeister: please send a photo of the damage (ticket #${t.id}): ${link}`,
    );
    await ticketEvent(t.id, "photo_link", sms.sent ? "Photo link texted to the tenant" : `Photo link not sent (${sms.error})`);
    return sms.sent
      ? { sent: true, message: "Photo link sent by SMS. Ask the tenant to tap it and take a photo, then check_photo." }
      : { sent: false, message: "The text could not be sent. Skip the photo and carry on." };
  },

  async check_photo(input) {
    const t = await getTicket(asId(input.ticket_id));
    if (!t) return { uploaded: false, message: "No ticket with that number." };
    if (!t.photo_assessment) {
      return { uploaded: false, message: "Not uploaded yet. Ask the tenant if they've sent it, wait a moment, then check again once." };
    }
    return {
      uploaded: true,
      assessment: t.photo_assessment,
      urgency: t.urgency,
      safety_advice: t.photo_safety_advice ?? "",
    };
  },

  async dispatch_contractor(input) {
    const r = await dispatchTicket(asId(input.ticket_id));
    if (!r.started) return { started: false, contractor_name: "", message: r.reason };
    return {
      started: true,
      contractor_name: r.contractor.name,
      message: `Calling ${r.contractor.name} the ${r.contractor.trade} now. The tenant gets a text with the time once it's booked.`,
    };
  },

  async confirm_slot(input) {
    const ticketId = asId(input.ticket_id);
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
          : ` They'll check ${visitFirst} first for the source.`
        : "";
    await ticketEvent(ticketId, "booked", `${name} booked for ${formatSlot(res.scheduled_at!, res.ends_at!, "en")}`);

    let smsSent = false;
    if (t?.tenant) {
      const body =
        lang === "de"
          ? `Hausmeister: ${name}${company} kommt ${when} zu Ihnen (Ticket #${ticketId}).${firstNote}`
          : `Hausmeister: ${name}${company} is booked for ${when} at your flat ${t.unit.label} (ticket #${ticketId}).${firstNote}`;
      const sms = await sendSms(t.tenant.phone, body);
      smsSent = sms.sent;
      await ticketEvent(ticketId, "sms", sms.sent ? `Tenant texted: "${body}"` : `Tenant SMS failed (${sms.error})`);
    }
    return {
      confirmed: true,
      scheduled_at: res.scheduled_at!,
      tenant_sms_sent: smsSent,
      message: `Booked for ${formatSlot(res.scheduled_at!, res.ends_at!, t?.contractor?.language ?? "en")}. Thank the contractor and end the call.`,
    };
  },
};
