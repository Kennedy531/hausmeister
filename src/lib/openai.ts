// OWNED BY TRACK B. Live English subtitles for the dashboard transcript.

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
