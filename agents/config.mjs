// Agent definitions pushed to Vapi by scripts/sync-agents.mjs. Keep the agents as code.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const ISSUE = { type: "string", enum: ["leak", "heating", "electrical", "lock", "appliance", "pest", "other"] };
const URGENCY = { type: "string", enum: ["emergency", "urgent", "normal"] };
const TRADE = { type: "string", enum: ["plumber", "electrician", "locksmith", "handyman"] };
const TICKET = { type: "number", description: "ticket_id returned by create_ticket" };
const UNIT = { type: "string", description: "Apartment label, e.g. 3B" };

export const tenantTools = [
  fn("lookup_tenant", "Look up the caller by caller ID. Only call when the caller is not already known."),
  fn("get_building_context", "Check the building's recent history for the same issue in the caller's stack.", { unit: UNIT, issue_type: ISSUE }, ["unit", "issue_type"]),
  fn("create_ticket", "Create the repair ticket once the issue and urgency are clear.", {
    unit: UNIT, issue_type: ISSUE, urgency: URGENCY,
    summary: { type: "string", description: "One sentence in English describing the problem" },
  }, ["unit", "issue_type", "urgency", "summary"]),
  fn("dispatch_contractor", "Phone the best available contractor for this ticket, offering only slots when the tenant is home. The tenant call can end after this.", {
    ticket_id: TICKET,
    trade: TRADE,
    available_from: { type: "string", description: "When the tenant is home from, today, as 24-hour HH:MM (e.g. 'after six' = 18:00). Leave out if any time or right now." },
    available_until: { type: "string", description: "Until when the tenant is home, as 24-hour HH:MM. Leave out if they didn't say." },
  }, ["ticket_id", "trade"]),
  { type: "endCall" },
];

export const dispatcherTools = [
  fn("confirm_slot", "Book the slot the contractor accepted and text the tenant.", {
    ticket_id: TICKET,
    slot_id: { type: "number", description: "The slot_id of the time the contractor accepted" },
  }, ["ticket_id", "slot_id"]),
  { type: "endCall" },
];

export function buildAssistants(env) {
  // --only=tenant or --only=dispatcher syncs just one agent (see scripts/sync-agents.mjs).
  const server = {
    url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/vapi`,
    headers: { "X-Vapi-Secret": env.VAPI_WEBHOOK_SECRET },
  };
  // Turbo v2.5 sounds far more natural than Flash and is still fast enough for phone calls.
  // Lower stability = more expressive, less monotone; speaker boost keeps it close to the original voice.
  const voiceFor = (voiceId) => ({
    provider: "11labs",
    voiceId,
    model: env.ELEVENLABS_MODEL || "eleven_turbo_v2_5",
    stability: 0.4,
    similarityBoost: 0.8,
    useSpeakerBoost: true,
  });
  const tenantVoice = voiceFor(env.ELEVENLABS_VOICE_ID);
  const dispatcherVoice = voiceFor(env.ELEVENLABS_DISPATCHER_VOICE_ID || env.ELEVENLABS_VOICE_ID);
  const model = (prompt, tools) => ({
    provider: "openai",
    model: env.VAPI_MODEL || "gpt-4.1-mini",
    temperature: 0.3,
    messages: [{ role: "system", content: prompt }],
    tools,
  });
  const transcriber = { provider: "deepgram", model: "nova-3", language: env.DEEPGRAM_LANGUAGE || "multi" };
  const serverMessages = ["tool-calls", "status-update", "end-of-call-report", 'transcript[transcriptType="final"]'];

  return {
    tenant: {
      name: "Hausmeister Tenant Line",
      firstMessage:
        "{{ first_message | default: 'Hello, this is Hausmeister, your building caretaker. How can I help?' }}",
      model: model(read("./tenant/prompt.md"), tenantTools),
      voice: tenantVoice,
      transcriber,
      server,
      serverMessages,
      maxDurationSeconds: 300,
    },
    dispatcher: {
      name: "Hausmeister Dispatcher",
      firstMessage:
        "{% if language == 'de' %}Hallo {{ contractor_name }}, hier ist Hausmeister mit einem Auftrag in {{ building }}. Haben Sie kurz Zeit?{% elsif language == 'nl' %}Hoi {{ contractor_name }}, met Hausmeister. Ik bel over een klus in {{ building }}. Heeft u even?{% else %}Hi {{ contractor_name }}, this is Hausmeister calling about a job at {{ building }}. Have you got a moment?{% endif %}",
      model: model(read("./dispatcher/prompt.md"), dispatcherTools),
      voice: dispatcherVoice,
      transcriber,
      server,
      serverMessages,
      maxDurationSeconds: 180,
    },
  };
}
