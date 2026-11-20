#!/usr/bin/env node
// Sends Vapi-shaped tool-call requests to the webhook, so it can be tested without a phone.
//
//   node scripts/fake-tool-call.mjs                          run the whole demo flow
//   node scripts/fake-tool-call.mjs create_ticket '{"unit":"3B","issue_type":"leak","urgency":"urgent","summary":"Ceiling drip"}'
//
// Env (read from .env.local if present):
//   VAPI_URL              default http://localhost:3000/api/vapi (or an ngrok / Vercel URL)
//   VAPI_WEBHOOK_SECRET   sent as X-Vapi-Secret
//   FAKE_CALLER           caller number, default the seeded 3B tenant placeholder

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: fine
}

const url = process.env.VAPI_URL ?? "http://localhost:3000/api/vapi";
const secret = process.env.VAPI_WEBHOOK_SECRET ?? "";
const caller = process.env.FAKE_CALLER ?? "+490000000003";
const callId = `fake-${Date.now()}`;
const startedAt = new Date().toISOString();

async function callTool(name, args = {}) {
  const body = {
    message: {
      type: "tool-calls",
      timestamp: Date.now(),
      customer: { number: caller },
      call: { id: callId, type: "inboundPhoneCall", createdAt: startedAt, customer: { number: caller } },
      toolCallList: [{ id: `tc-${name}-${Date.now()}`, type: "function", function: { name, arguments: args } }],
    },
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-vapi-secret": secret } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  const r = json.results?.[0];
  const ms = Date.now() - t0;
  if (res.status !== 200 || !r) {
    console.log(`✗ ${name}  HTTP ${res.status}  ${JSON.stringify(json)}`);
    return null;
  }
  if (r.error) {
    console.log(`✗ ${name}  ${ms}ms  error: ${r.error}`);
    return null;
  }
  const output = JSON.parse(r.result);
  console.log(`✓ ${name}  ${ms}ms  ${r.result}`);
  return output;
}

const [, , tool, rawArgs] = process.argv;

if (tool) {
  await callTool(tool, rawArgs ? JSON.parse(rawArgs) : {});
} else {
  console.log(`Demo flow against ${url} as ${caller}\n`);
  await callTool("lookup_tenant");
  await callTool("get_building_context", { unit: "3b", issue_type: "leak" });
  const ticket = await callTool("create_ticket", {
    unit: "3B",
    issue_type: "leak",
    urgency: "urgent",
    summary: "Water dripping from the ceiling near the light fixture",
  });
  const id = ticket?.ticket_id ?? 0;
  await callTool("send_photo_link", { ticket_id: id });
  await callTool("check_photo", { ticket_id: String(id) }); // id as a string, like an LLM might send
  await callTool("dispatch_contractor", { ticket_id: id, trade: "plumber" });
  await callTool("confirm_slot", { ticket_id: id, slot_id: 1 });
  console.log("\nExpected failure (bad arguments):");
  await callTool("create_ticket", { unit: "3B", issue_type: "flood" });
}
