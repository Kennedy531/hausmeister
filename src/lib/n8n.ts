// Hands every booked job to the n8n workflow in n8n/hausmeister-owner-update.json.
// The workflow writes an update for the property owner with OpenAI and flags repeat
// issues for a preventive inspection, then sends both back to log on the ticket.
// Off unless N8N_WEBHOOK_URL is set. Runs after the response (see confirm_slot), so it
// never slows down the call, and it never throws.
import { ticketEvent } from "@/lib/db";

export interface BookingForN8n {
  ticket_id: number;
  building: string;
  unit: string;
  stack: string;
  issue_type: string;
  urgency: string;
  summary: string;
  contractor: string;
  company: string | null;
  trade: string;
  scheduled: string; // e.g. "today 16:00 to 18:00"
  pattern: boolean; // repeat issue in the same stack within 30 days
  call_to_booked_seconds: number | null;
}

export function n8nConfigured(): boolean {
  return Boolean(process.env.N8N_WEBHOOK_URL);
}

export async function sendBookingToN8n(booking: BookingForN8n): Promise<void> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET ? { "X-Hausmeister-Secret": process.env.N8N_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(booking),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`n8n answered ${res.status}`);
    const out = (await res.json()) as { owner_update?: string; follow_up?: string };
    if (out.owner_update) await ticketEvent(booking.ticket_id, "owner_update", `Owner update (n8n): ${out.owner_update}`);
    if (out.follow_up) await ticketEvent(booking.ticket_id, "follow_up", `Follow-up (n8n): ${out.follow_up}`);
  } catch (e) {
    console.error("n8n workflow failed", e);
  }
}
