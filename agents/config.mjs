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
  fn("send_photo_link", "Text the tenant a link to upload a photo of the damage.", { ticket_id: TICKET }, ["ticket_id"]),
  fn("check_photo", "Check whether the tenant's photo has arrived and get the assessment.", { ticket_id: TICKET }, ["ticket_id"]),
  fn("dispatch_contractor", "Phone the best available contractor for this ticket. The tenant call can end after this.", { ticket_id: TICKET, trade: TRADE }, ["ticket_id", "trade"]),
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
  const server = {
    url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/vapi`,
    headers: { "X-Vapi-Secret": env.VAPI_WEBHOOK_SECRET },
  };
  const voice = {
    provider: "11labs",
    voiceId: env.ELEVENLABS_VOICE_ID,
    model: env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
  };
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
      voice,
      transcriber,
      server,
      serverMessages,
      maxDurationSeconds: 300,
    },
    dispatcher: {
      name: "Hausmeister Dispatcher",
      firstMessage:
        "{% if language == 'de' %}Hallo {{ contractor_name }}, hier ist Hausmeister mit einem Auftrag in {{ building }}. Haben Sie kurz Zeit?{% else %}Hi {{ contractor_name }}, this is Hausmeister calling about a job at {{ building }}. Have you got a moment?{% endif %}",
      model: model(read("./dispatcher/prompt.md"), dispatcherTools),
      voice,
      transcriber,
      server,
      serverMessages,
      maxDurationSeconds: 180,
    },
  };
}
