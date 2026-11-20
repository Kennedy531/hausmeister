// Creates or updates both Vapi assistants from agents/, and points the phone number at the webhook.
//   node scripts/sync-agents.mjs            create/update both assistants + phone number
//   node scripts/sync-agents.mjs --no-phone leave the phone number alone
// Prints the assistant ids to put in .env.local on first run.
import { env } from "./env.mjs";
import { buildAssistants } from "../agents/config.mjs";

const need = ["VAPI_API_KEY", "PUBLIC_BASE_URL", "VAPI_WEBHOOK_SECRET", "ELEVENLABS_VOICE_ID"];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error("Missing in .env.local:", missing.join(", "));
  process.exit(1);
}

async function vapi(method, path, body) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text}`);
  return text ? JSON.parse(text) : {};
}

const assistants = buildAssistants(env);
const ids = {};
for (const [key, idVar] of [["tenant", "VAPI_TENANT_ASSISTANT_ID"], ["dispatcher", "VAPI_DISPATCHER_ASSISTANT_ID"]]) {
  const existing = env[idVar];
  const a = existing
    ? await vapi("PATCH", `/assistant/${existing}`, assistants[key])
    : await vapi("POST", "/assistant", assistants[key]);
  ids[idVar] = a.id;
  console.log(`${existing ? "updated" : "created"} ${assistants[key].name}: ${a.id}`);
}

if (!process.argv.includes("--no-phone") && env.VAPI_PHONE_NUMBER_ID) {
  // No fixed assistant on the number: Vapi sends assistant-request to the webhook, which
  // matches the caller ID and starts the tenant agent with the name and unit already known.
  await vapi("PATCH", `/phone-number/${env.VAPI_PHONE_NUMBER_ID}`, {
    assistantId: null,
    server: { url: assistants.tenant.server.url, headers: assistants.tenant.server.headers },
  });
  console.log("phone number now sends assistant-request to", assistants.tenant.server.url);
}

const newOnes = Object.entries(ids).filter(([k]) => !env[k]);
if (newOnes.length) {
  console.log("\nAdd to .env.local (and Vercel env):");
  for (const [k, v] of newOnes) console.log(`${k}=${v}`);
}
