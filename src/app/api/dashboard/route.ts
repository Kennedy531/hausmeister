// GET: everything the dashboard shows, in one payload. The browser only uses Supabase
// realtime as a "something changed" trigger and refetches here (no phone numbers leave the server).
import { connection } from "next/server";
import { db, must } from "@/lib/db";
import { formatSlot, formatTime, formatWindow, startsInWindow } from "@/lib/time";

const TICKET_COLUMNS = `id, unit_id, visit_unit_id, issue_type, urgency, status, summary, photo_path, photo_assessment, photo_safety_advice,
  pattern_flag, pattern_note, contractor_id, scheduled_at, call_started_at, booked_at, created_at, seed,
  tenant_call_id, dispatcher_call_id, dispatch_attempts, escalation_reason,
  contractor:contractors(name, company, trade, rating, language),
  tenant:tenants(name),
  events:ticket_events(id, kind, message, created_at)`;

function ticketQuery(sb: ReturnType<typeof db>, withAvailability: boolean) {
  return sb
    .from("tickets")
    .select(withAvailability ? `${TICKET_COLUMNS}, available_from, available_until` : TICKET_COLUMNS)
    .order("id", { ascending: false })
    .limit(30);
}

export async function GET() {
  await connection();
  const sb = db();
  const [buildings, units, tickets, calls, rules, slots] = await Promise.all([
    sb.from("buildings").select("id, name, address, city, floors, build_year, boiler_type, last_boiler_service").limit(1),
    sb.from("units").select("id, label, floor, stack").order("floor"),
    // Falls back to the older columns until supabase/migrations/002 (tenant availability) has been run.
    ticketQuery(sb, true).then((r) => (r.error ? ticketQuery(sb, false) : r)),
    // Falls back to the pre-translation columns until supabase/migrations/001 has been run.
    sb.from("call_events").select("id, call_id, agent, role, text, lang, translation, ticket_id, created_at").order("id", { ascending: false }).limit(200)
      .then((r) => (r.error ? sb.from("call_events").select("id, call_id, agent, role, text, ticket_id, created_at").order("id", { ascending: false }).limit(200) : r)),
    sb.from("lease_rules").select("issue_type, responsible, note"),
    sb.from("contractor_slots").select("id, contractor_id, starts_at, ends_at, booked").order("starts_at"),
  ]);

  const unitRows = must(units, "units") as { id: number; label: string; floor: number; stack: string }[];
  const label = (id: number | null) => unitRows.find((u) => u.id === id)?.label ?? null;
  const slotRows = must(slots, "slots") as { id: number; contractor_id: number; starts_at: string; ends_at: string; booked: boolean }[];

  type TicketRow = Record<string, unknown> & {
    id: number; unit_id: number; visit_unit_id: number | null; contractor_id: number | null; photo_path: string | null;
    scheduled_at: string | null; events: { id: number; created_at: string }[];
    contractor: { name: string; company: string | null; rating: number; language: string } | null;
    tenant: { name: string } | null;
  };
  const ticketRows = must(tickets, "tickets") as unknown as TicketRow[];

  const out = await Promise.all(
    ticketRows.map(async (t) => {
      let photo_url: string | null = null;
      if (t.photo_path) {
        const s = await sb.storage.from("photos").createSignedUrl(t.photo_path, 3600);
        photo_url = s.data?.signedUrl ?? null;
      }
      const unit = unitRows.find((u) => u.id === t.unit_id);
      return {
        ...t,
        photo_path: undefined,
        unit: unit?.label ?? "?",
        stack: unit?.stack ?? "?",
        visit_first: label(t.visit_unit_id),
        contractor_name: t.contractor?.name ?? null,
        contractor_company: t.contractor?.company ?? null,
        contractor_rating: t.contractor?.rating ?? null,
        contractor_language: t.contractor?.language ?? null,
        tenant_name: t.tenant?.name ?? null,
        tenant: undefined,
        contractor: undefined,
        scheduled_label: t.scheduled_at ? formatTime(t.scheduled_at) : null,
        tenant_window:
          t.available_from || t.available_until ? formatWindow((t.available_from as string) ?? null, (t.available_until as string) ?? null) : null,
        photo_url,
        events: [...(t.events ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id),
        // The slots the dispatcher may offer: this contractor's free ones that fit when the tenant is home.
        offered_slots: slotRows
          .filter((s) => s.contractor_id === t.contractor_id && (!s.booked || t.scheduled_at === s.starts_at))
          .filter((s) => startsInWindow(s.starts_at, t.available_from as string | null, t.available_until as string | null))
          .slice(0, 2)
          .map((s) => ({ id: s.id, label: formatSlot(s.starts_at, s.ends_at), booked: s.booked })),
      };
    }),
  );

  return Response.json({
    now: new Date().toISOString(),
    building: (must(buildings, "buildings") as unknown[])[0] ?? null,
    units: unitRows,
    tickets: out,
    calls: (must(calls, "calls") as unknown[]).reverse(),
    lease_rules: must(rules, "rules"),
  });
}
