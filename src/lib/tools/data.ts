// OWNED BY TRACK B. Shared database helpers for the tool handlers.
import { db, must } from "@/lib/db";
import type { IssueType, Language, Trade, Urgency, TicketStatus } from "@/lib/contract";

export interface TicketFull {
  id: number;
  issue_type: IssueType;
  urgency: Urgency;
  status: TicketStatus;
  summary: string;
  pattern_flag: boolean;
  pattern_note: string | null;
  contractor_id: number | null;
  slot_id: number | null;
  scheduled_at: string | null;
  tenant_call_id: string | null;
  dispatcher_call_id: string | null;
  dispatch_attempts: number;
  tried_contractor_ids: number[];
  call_started_at: string | null;
  booked_at: string | null;
  /** Missing until supabase/migrations/002 has been run. */
  available_from?: string | null;
  available_until?: string | null;
  unit: { id: number; label: string; floor: number; stack: string; building: Building };
  visit_unit: { label: string } | null;
  tenant: { id: number; name: string; phone: string; language: Language } | null;
  contractor: Contractor | null;
}

export interface Building {
  id: number;
  name: string;
  address: string;
  city: string;
}

export interface Contractor {
  id: number;
  name: string;
  company: string | null;
  trade: Trade;
  phone: string;
  rating: number;
  language: Language;
}

const TICKET_SELECT = `*,
  unit:units!tickets_unit_id_fkey(id, label, floor, stack, building:buildings(id, name, address, city)),
  visit_unit:units!tickets_visit_unit_id_fkey(label),
  tenant:tenants(id, name, phone, language),
  contractor:contractors(id, name, company, trade, phone, rating, language)`;

export async function getTicket(id: number): Promise<TicketFull | null> {
  const res = await db().from("tickets").select(TICKET_SELECT).eq("id", id).maybeSingle();
  return must(res, "load ticket") as TicketFull | null;
}

export async function getTicketByCall(column: "tenant_call_id" | "dispatcher_call_id", callId: string) {
  const res = await db().from("tickets").select(TICKET_SELECT).eq(column, callId).order("id", { ascending: false }).limit(1);
  const rows = must(res, "load ticket by call") as TicketFull[];
  return rows[0] ?? null;
}

/** Normalises a phone number to E.164-ish digits with a leading +. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  return p || null;
}

export async function findTenantByPhone(raw: string | null) {
  const phone = normalisePhone(raw);
  if (!phone) return null;
  const select = "id, name, phone, language, unit:units(id, label, building:buildings(id, name))";
  const exact = must(await db().from("tenants").select(select).eq("phone", phone).limit(1), "tenant lookup");
  if (exact[0]) return exact[0] as unknown as TenantRow;
  // Fallback: match on the last 9 digits (catches +31 6... vs 06... and similar formatting differences).
  const tail = phone.replace(/\D/g, "").slice(-9);
  if (tail.length < 9) return null;
  const loose = must(await db().from("tenants").select(select).like("phone", `%${tail}`).limit(1), "tenant lookup");
  return (loose[0] as unknown as TenantRow) ?? null;
}

export interface TenantRow {
  id: number;
  name: string;
  phone: string;
  language: Language;
  unit: { id: number; label: string; building: { id: number; name: string } };
}

/** Turns "apartment 3b", "3 B" or "Wohnung 3B" into "3B". */
export function cleanUnitLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.toUpperCase().match(/(\d+)\s*([A-Z])\b/);
  return m ? `${m[1]}${m[2]}` : raw.trim().toUpperCase() || null;
}

export async function findUnit(label: string | null) {
  const clean = cleanUnitLabel(label);
  if (!clean) return null;
  const rows = must(await db().from("units").select("id, label, floor, stack, building_id").eq("label", clean).limit(1), "unit lookup");
  return (rows[0] as { id: number; label: string; floor: number; stack: string; building_id: number }) ?? null;
}

export interface BuildingContextRow {
  found: boolean;
  caller_unit: string | null;
  caller_floor: number | null;
  similar_recent: { unit: string; floor: number; issue_type: IssueType; summary: string; days_ago: number }[];
  pattern: boolean;
  visit_first: string | null;
}

export async function buildingContext(unit: string, issue: IssueType): Promise<BuildingContextRow> {
  const res = await db().rpc("building_context", { p_unit: unit, p_issue: issue });
  return must(res, "building_context") as BuildingContextRow;
}

const ISSUE_WORD: Record<IssueType, Record<Language, string>> = {
  leak: { en: "leak", de: "Wasserschaden", nl: "lekkage" },
  heating: { en: "heating", de: "Heizungs", nl: "verwarmings" },
  electrical: { en: "electrical", de: "Elektrik", nl: "elektra" },
  lock: { en: "lock", de: "Schloss", nl: "slot" },
  appliance: { en: "appliance", de: "Geräte", nl: "apparaat" },
  pest: { en: "pest", de: "Schädlings", nl: "ongedierte" },
  other: { en: "similar", de: "ähnliche", nl: "vergelijkbare" },
};

const TRADE_WORD: Record<Trade, Record<Language, string>> = {
  plumber: { en: "plumber", de: "den Installateur", nl: "de loodgieter" },
  electrician: { en: "electrician", de: "den Elektriker", nl: "de elektricien" },
  locksmith: { en: "locksmith", de: "den Schlüsseldienst", nl: "de slotenmaker" },
  handyman: { en: "handyman", de: "den Hausmeisterservice", nl: "de klusjesman" },
};

function ordinal(n: number, lang: Language) {
  if (lang === "de") return `${n}.`;
  if (lang === "nl") return ["", "eerste", "tweede", "derde", "vierde", "vijfde", "zesde"][n] ?? `${n}e`;
  return ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth"][n] ?? `${n}th`;
}

function when(days: number, lang: Language) {
  if (lang === "de") {
    if (days === 0) return "heute";
    if (days === 1) return "gestern";
    if (days >= 5 && days <= 13) return "letzte Woche";
    return `vor ${days} Tagen`;
  }
  if (lang === "nl") {
    if (days === 0) return "vandaag";
    if (days === 1) return "gisteren";
    if (days >= 5 && days <= 13) return "vorige week";
    return `${days} dagen geleden`;
  }
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days >= 5 && days <= 13) return "last week";
  return `${days} days ago`;
}

/** The sentence the agent says in the context moment. Empty when there is no pattern. */
export function patternNote(ctx: BuildingContextRow, issue: IssueType, trade: Trade, lang: Language): string {
  if (!ctx.pattern || !ctx.caller_unit) return "";
  const count = ctx.similar_recent.length + 1;
  const first = ctx.similar_recent.find((s) => s.unit === ctx.visit_first);
  const issueWord = ISSUE_WORD[issue][lang];
  if (lang === "de") {
    let s = `Das ist schon die ${ordinal(count, lang)} ${issueWord}-Meldung in Ihrem Strang diesen Monat.`;
    if (first && ctx.caller_floor !== null) {
      const dir = first.floor > ctx.caller_floor ? "über Ihnen" : "unter Ihnen";
      s += ` ${first.unit} ${dir} hat ${when(first.days_ago, lang)} etwas gemeldet: ${first.summary}. Deshalb schicke ich ${TRADE_WORD[trade].de} zuerst zu ${first.unit}.`;
    }
    return s;
  }
  if (lang === "nl") {
    let s = `Dit is al de ${ordinal(count, lang)} ${issueWord}melding in uw stijgleiding deze maand.`;
    if (first && ctx.caller_floor !== null) {
      const dir = first.floor > ctx.caller_floor ? "boven u" : "onder u";
      s += ` ${first.unit} ${dir} meldde ${when(first.days_ago, lang)} ook een probleem, dus ik stuur ${TRADE_WORD[trade].nl} eerst naar ${first.unit}.`;
    }
    return s;
  }
  let s = `This is the ${ordinal(count, lang)} ${issueWord} report in your stack this month.`;
  if (first && ctx.caller_floor !== null) {
    const dir = first.floor > ctx.caller_floor ? "above" : "below";
    // "Bathroom leak under the bathtub, water pooling…" -> "a bathroom leak under the bathtub"
    const clause = first.summary.split(/[,.;]/)[0].trim();
    const what = clause ? `a ${clause.charAt(0).toLowerCase()}${clause.slice(1)}` : `a ${issueWord}`;
    s += ` ${first.unit} ${dir} you reported ${what} ${when(first.days_ago, lang)}, so I'm sending the ${TRADE_WORD[trade].en} to ${first.unit} first.`;
  }
  return s;
}
