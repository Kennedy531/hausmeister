// OWNED BY TRACK B. Photo assessment with an OpenAI vision model.
import type { IssueType, Urgency } from "@/lib/contract";

export interface PhotoAssessment {
  assessment: string;
  urgency: Urgency;
  safety_advice: string;
}

const MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

export async function assessPhoto(
  image: { base64: string; mimeType: string },
  ticket: { issue_type: IssueType; summary: string },
): Promise<PhotoAssessment> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      assessment: "Photo received (no OPENAI_API_KEY set, so it was not analysed).",
      urgency: "urgent",
      safety_advice: "Keep away from any wet electrics until the contractor arrives.",
    };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a building caretaker assessing a tenant's photo of damage. Reply with JSON only: " +
            '{"assessment": one short spoken sentence describing what you see, ' +
            '"urgency": "emergency" | "urgent" | "normal", ' +
            '"safety_advice": one short instruction for the tenant, e.g. switch off that circuit}. ' +
            "Water close to a light, socket or wiring is at least urgent and the advice must be to switch off that circuit at the fuse box and not touch it. " +
            "Visible fire, smoke or sparking is an emergency.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Reported issue: ${ticket.issue_type}. Tenant said: ${ticket.summary}` },
            { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "low" } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  const urgency: Urgency = ["emergency", "urgent", "normal"].includes(parsed.urgency) ? parsed.urgency : "urgent";
  return {
    assessment: String(parsed.assessment || "Photo received."),
    urgency,
    safety_advice: String(parsed.safety_advice || ""),
  };
}

const TRANSLATE_MODEL = process.env.OPENAI_TRANSLATE_MODEL || "gpt-4.1-mini";

/**
 * Live subtitles for the dashboard: detects the language of one transcript line and,
 * if it isn't English, translates it. Returns null without an OPENAI_API_KEY.
 */
export async function translateLine(text: string): Promise<{ lang: string; english: string | null } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text.trim()) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You subtitle a phone call between a property caretaker and a tenant or contractor. Reply with JSON only: {"lang": ISO 639-1 code of the line, "english": natural English translation, or null if the line is already English}. Keep names, times and apartment numbers as they are.',
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  const lang = typeof parsed.lang === "string" ? parsed.lang.toLowerCase().slice(0, 5) : "en";
  const english = lang !== "en" && typeof parsed.english === "string" && parsed.english.trim() ? parsed.english.trim() : null;
  return { lang, english };
}
