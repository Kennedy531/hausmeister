// POST: clears every call-created ticket and transcript, re-anchors the seed history, fresh slots.
import type { NextRequest } from "next/server";
import { db, must } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const out = must(await db().rpc("reset_demo"), "reset_demo");
  return Response.json(out);
}
