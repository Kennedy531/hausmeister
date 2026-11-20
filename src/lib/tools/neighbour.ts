// OWNED BY TRACK B. The contractor starts in the flat above (the pattern rule's "visit first"),
// so that tenant has to know and let them in. Texted on booking; a "YES" reply is recorded
// by /api/sms/inbound and shows on the dashboard as access confirmed.
import { db, must, ticketEvent } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import { formatSlot } from "@/lib/time";
import type { Language } from "@/lib/contract";
import { findUnit, normalisePhone, type TicketFull } from "./data";

interface NeighbourRow {
  id: number;
  name: string;
  phone: string;
  language: Language;
  unit_id: number;
}

export async function notifyNeighbour(t: TicketFull, startsAt: string, endsAt: string) {
  const visit = t.visit_unit?.label;
  if (!visit || visit === t.unit.label) return;
  const unit = await findUnit(visit);
  if (!unit) return;
  const rows = must(
    await db().from("tenants").select("id, name, phone, language, unit_id").eq("unit_id", unit.id).limit(1),
    "neighbour lookup",
  ) as NeighbourRow[];
  const n = rows[0];
  if (!n) return;

  const first = n.name.split(" ")[0];
  const when = formatSlot(startsAt, endsAt, n.language);
  const trade = t.contractor?.trade ?? "plumber";
  const who = t.contractor?.name ?? "The contractor";
  const body =
    n.language === "de"
      ? `Hausmeister: Hallo ${first}, ${who} (Installateur) kommt ${when}, um ein Leck zu prüfen, das die Wohnungen unter Ihnen betrifft. Er beginnt in Ihrer Wohnung ${visit}. Antworten Sie JA, wenn er hereinkommen darf.`
      : n.language === "nl"
        ? `Hausmeister: Hoi ${first}, ${who} (loodgieter) komt ${when} voor een lekkage die de woningen onder u raakt. Hij begint in uw woning ${visit}. Antwoord JA als hij binnen mag.`
        : `Hausmeister: Hi ${first}, ${who} the ${trade} is coming ${when} to check a leak affecting the flats below you, starting in your flat ${visit}. Reply YES to confirm access.`;
  const sms = await sendSms(n.phone, body);
  await ticketEvent(
    t.id,
    "neighbour",
    sms.sent ? `Neighbour in ${visit} (${n.name}) asked for access` : `Neighbour in ${visit} (${n.name}) not texted (${sms.error})`,
  );
}

/** Records a neighbour's reply. Returns the text to send back, or null if it doesn't belong to a booking. */
export async function onNeighbourReply(fromRaw: string, body: string): Promise<string | null> {
  const from = normalisePhone(fromRaw);
  if (!from) return null;
  const tenants = must(
    await db().from("tenants").select("id, name, language, unit_id, phone").eq("phone", from).limit(1),
    "reply tenant",
  ) as NeighbourRow[];
  const n = tenants[0];
  if (!n) return null;

  // The latest booked ticket whose contractor starts in this tenant's flat, in the last day.
  const since = new Date(Date.now() - 86400e3).toISOString();
  const tickets = must(
    await db()
      .from("tickets")
      .select("id")
      .eq("visit_unit_id", n.unit_id)
      .neq("unit_id", n.unit_id)
      .eq("status", "scheduled")
      .gt("created_at", since)
      .order("id", { ascending: false })
      .limit(1),
    "reply ticket",
  ) as { id: number }[];
  const ticket = tickets[0];
  if (!ticket) return null;

  const yes = /^\s*(y|yes|yeah|ja|jep|ok|okay|sure|prima|goed)\b/i.test(body);
  await ticketEvent(
    ticket.id,
    yes ? "access" : "neighbour",
    yes ? `${n.name} confirmed access` : `${n.name} replied: "${body.trim().slice(0, 120)}"`,
  );
  if (!yes) return null;
  return n.language === "de"
    ? "Danke! Wir haben es dem Installateur gesagt."
    : n.language === "nl"
      ? "Bedankt! We hebben het de loodgieter laten weten."
      : "Thanks! We've let the contractor know.";
}
