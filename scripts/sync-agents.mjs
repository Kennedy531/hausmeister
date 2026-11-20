#!/usr/bin/env node
// Pushes the voice agents in agents/ to Vapi, and points the phone number at our webhook.
// Agents are matched by name: created the first time, updated after that.
//
//   node scripts/sync-agents.mjs            create or update agents in Vapi
//   node scripts/sync-agents.mjs --dry-run  print what would be sent, call nothing
//
// Needs in .env.local: VAPI_API_KEY, PUBLIC_BASE_URL, VAPI_CREDENTIAL_ID, VAPI_PHONE_NUMBER_ID.
// Optional: VAPI_OPENAI_MODEL (default gpt-4.1-mini), ELEVENLABS_VOICE_ID (default "sarah").
import { tenantAssistant } from "../agents/tenant/assistant.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local
}

const dryRun = process.argv.includes("--dry-run");
const env = process.env;
const API = "https://api.vapi.ai";

function need(name) {
  const value = env[name];
  if (!value) {
    if (dryRun) return `<${name}>`;
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return value;
}

async function vapi(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.VAPI_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** Creates the assistant, or updates the one with the same name. Returns its id. */
async function upsertAssistant(config) {
  const existing = (await vapi("GET", "/assistant?limit=100")).find((a) => a.name === config.name);
  const saved = existing
    ? await vapi("PATCH", `/assistant/${existing.id}`, config)
    : await vapi("POST", "/assistant", config);

  // Make sure the tool list really was replaced, not merged.
  const want = config.model.tools.map((t) => t.function?.name ?? t.type).sort().join(",");
  const got = (saved.model?.tools ?? []).map((t) => t.function?.name ?? t.type).sort().join(",");
  if (want !== got) console.warn(`  ! tools in Vapi (${got}) differ from agents/ (${want})`);

  console.log(`✓ ${existing ? "updated" : "created"} "${config.name}"  id ${saved.id}`);
  return saved.id;
}

const server = {
  url: `${need("PUBLIC_BASE_URL").replace(/\/$/, "")}/api/vapi`,
  credentialId: need("VAPI_CREDENTIAL_ID"),
};
const tenant = tenantAssistant({
  server,
  model: env.VAPI_OPENAI_MODEL || "gpt-4.1-mini",
  voiceId: env.ELEVENLABS_VOICE_ID || "sarah",
});
// The phone number has no fixed assistant: Vapi sends an assistant-request to our webhook,
// which answers with the tenant assistant and the caller's details.
const phoneNumberPatch = { assistantId: null, server };

if (dryRun) {
  console.log(JSON.stringify({ assistants: [tenant], phoneNumber: phoneNumberPatch }, null, 2));
  process.exit(0);
}

need("VAPI_API_KEY");
const phoneNumberId = need("VAPI_PHONE_NUMBER_ID");
const tenantId = await upsertAssistant(tenant);

try {
  await vapi("PATCH", `/phone-number/${phoneNumberId}`, phoneNumberPatch);
  console.log(`✓ phone number now asks ${server.url} which assistant to use`);
} catch (err) {
  console.warn(`! could not update the phone number: ${err.message}`);
  console.warn("  In the Vapi dashboard, open the number, clear its assistant, and set the server URL and credential.");
}

if (env.VAPI_TENANT_ASSISTANT_ID !== tenantId) {
  console.log(`\nAdd this to .env.local and to the deploy's environment variables:\nVAPI_TENANT_ASSISTANT_ID=${tenantId}`);
}
