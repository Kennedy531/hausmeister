// OWNED BY TRACK B. Server-only Supabase client (secret key, bypasses RLS).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Throws on a Supabase error so tool handlers can report it, otherwise returns the data. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/** Adds a line to a ticket's timeline on the dashboard. Never throws. */
export async function ticketEvent(ticketId: number, kind: string, message: string) {
  const { error } = await db().from("ticket_events").insert({ ticket_id: ticketId, kind, message });
  if (error) console.error("ticket_events insert failed", error.message);
}

/** Adds a line to the live transcript panel and returns its id. Never throws. */
export async function callEvent(e: {
  callId: string;
  agent: "tenant" | "dispatcher";
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  ticketId?: number | null;
}): Promise<number | null> {
  const { data, error } = await db()
    .from("call_events")
    .insert({ call_id: e.callId, agent: e.agent, role: e.role, text: e.text, ticket_id: e.ticketId ?? null })
    .select("id")
    .single();
  if (error) console.error("call_events insert failed", error.message);
  return (data as { id: number } | null)?.id ?? null;
}
