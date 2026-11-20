// Tenant agent: answers inbound calls on the Vapi number.
// Pushed to Vapi by scripts/sync-agents.mjs. Edit here, not in the Vapi dashboard.
import { readFileSync } from "node:fs";
import { functionTools } from "../tools.mjs";

export const NAME = "Hausmeister Tenant";

/** @param {{ server: { url: string, credentialId?: string }, model: string, voiceId: string }} opts */
export function tenantAssistant({ server, model, voiceId }) {
  const prompt = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");
  return {
    name: NAME,
    // {{greeting}} is set by the webhook's assistant-request reply (caller ID lookup).
    firstMessage:
      '{{ greeting | default: "Hi, this is Hausmeister, the caretaker line. What can I help you with?" }}',
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model,
      temperature: 0.3,
      messages: [{ role: "system", content: prompt }],
      tools: [
        ...functionTools(["lookup_tenant", "get_building_context", "create_ticket", "dispatch_contractor"], server),
        { type: "endCall" },
      ],
    },
    voice: {
      provider: "11labs",
      model: "eleven_flash_v2_5", // lowest latency, still multilingual for the German encore
      voiceId,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      // Names the speech recogniser would otherwise mishear in a noisy hall.
      keyterm: ["Hausmeister", "Tadiwa", "Building B", "Kaiserswerther", "3B", "4B", "2B", "plumber"],
    },
    server,
    serverMessages: ["tool-calls", "end-of-call-report"],
    backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 300,
    metadata: { app: "hausmeister", agent: "tenant" },
  };
}
