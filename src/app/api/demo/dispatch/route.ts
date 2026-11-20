// POST { ticket_id }: backup button. Dispatches through the same guard as the agent's tool.
import type { NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { dispatchTicket } from "@/lib/tools/dispatch";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const { ticket_id } = (await req.json().catch(() => ({}))) as { ticket_id?: number };
  const r = await dispatchTicket(Number(ticket_id));
  return Response.json(r.started ? { started: true, contractor: r.contractor.name } : r);
}
