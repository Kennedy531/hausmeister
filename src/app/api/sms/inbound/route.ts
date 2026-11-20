// Twilio "A message comes in" webhook for the Hausmeister number.
// Point the Twilio number's Messaging webhook at  <PUBLIC_BASE_URL>/api/sms/inbound  (HTTP POST).
// Requests are checked against Twilio's X-Twilio-Signature with TWILIO_AUTH_TOKEN.
import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { onNeighbourReply } from "@/lib/tools/neighbour";

function validTwilioSignature(req: NextRequest, params: URLSearchParams): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");
  if (!token || !signature) return false;
  // Twilio signs the exact public URL it called, then every POST field sorted by name.
  const base = (process.env.PUBLIC_BASE_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const url = base + req.nextUrl.pathname + req.nextUrl.search;
  const data = [...params.keys()].sort().reduce((acc, k) => acc + k + (params.get(k) ?? ""), url);
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function twiml(message: string | null) {
  const body = message ? `<Message>${message.replace(/[<&>]/g, "")}</Message>` : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const params = new URLSearchParams(await req.text());
  if (!validTwilioSignature(req, params)) return new Response("forbidden", { status: 403 });
  try {
    const reply = await onNeighbourReply(params.get("From") ?? "", params.get("Body") ?? "");
    return twiml(reply);
  } catch (e) {
    console.error("inbound sms failed", e);
    return twiml(null);
  }
}
