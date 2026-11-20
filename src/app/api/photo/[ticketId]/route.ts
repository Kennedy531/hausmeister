// POST multipart (field "photo"): the tenant's damage photo. Stored in the private "photos"
// bucket, assessed by the OpenAI vision model, and saved on the ticket for check_photo.
import type { NextRequest } from "next/server";
import { db, ticketEvent } from "@/lib/db";
import { assessPhoto, type PhotoAssessment } from "@/lib/openai";
import { getTicket } from "@/lib/tools/data";
import { isAdmin } from "@/lib/admin";
import type { Urgency } from "@/lib/contract";

const MAX_BYTES = 4 * 1024 * 1024; // the page downsizes photos well below this (Vercel's body limit is 4.5 MB)
const RANK: Record<Urgency, number> = { normal: 0, urgent: 1, emergency: 2 };

export async function POST(req: NextRequest, ctx: RouteContext<"/api/photo/[ticketId]">) {
  const { ticketId } = await ctx.params;
  const t = await getTicket(Number(ticketId));
  if (!t || t.status === "resolved") return Response.json({ error: "Unknown ticket" }, { status: 404 });

  let assessment: PhotoAssessment;
  let photoPath: string | null = null;

  if (req.nextUrl.searchParams.get("simulate") === "1") {
    // For scripts/simulate-demo.mjs and rehearsals without a camera.
    if (!isAdmin(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
    assessment = {
      assessment: "I can see a wet patch about 40 centimetres wide on the ceiling, spreading towards the light fixture.",
      urgency: "urgent",
      safety_advice: "Please switch off the circuit for that light at your fuse box and don't touch the fixture.",
    };
  } else {
    const form = await req.formData().catch(() => null);
    const file = form?.get("photo");
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return Response.json({ error: "Please attach a photo" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) return Response.json({ error: "Photo too large" }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());

    photoPath = `${t.id}/${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const up = await db().storage.from("photos").upload(photoPath, bytes, { contentType: file.type, upsert: true });
    if (up.error) {
      console.error("photo upload to storage failed", up.error.message);
      photoPath = null; // still assess it, the call matters more than the stored copy
    }
    try {
      assessment = await assessPhoto({ base64: bytes.toString("base64"), mimeType: file.type }, t);
    } catch (e) {
      console.error("vision failed", e);
      assessment = {
        assessment: "The photo arrived but could not be analysed automatically.",
        urgency: t.urgency,
        safety_advice: "Keep away from any wet electrics until the contractor arrives.",
      };
    }
  }

  // The photo can raise urgency to "urgent", never lower it, and never auto-escalate mid-call.
  const urgency: Urgency =
    RANK[assessment.urgency] > RANK[t.urgency] && assessment.urgency !== "emergency" ? assessment.urgency : t.urgency;
  await db()
    .from("tickets")
    .update({
      photo_path: photoPath ?? t.photo_path,
      photo_assessment: assessment.assessment,
      photo_safety_advice: assessment.safety_advice,
      urgency,
    })
    .eq("id", t.id);
  await ticketEvent(t.id, "photo", `Photo assessed: ${assessment.assessment}${urgency !== t.urgency ? ` (urgency raised to ${urgency})` : ""}`);

  return Response.json({ ok: true, assessment: assessment.assessment, safety_advice: assessment.safety_advice });
}
