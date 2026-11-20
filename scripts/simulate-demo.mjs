// Plays the whole six-moment demo against the webhook WITHOUT phones: the same payloads
// Vapi would send (assistant-request, transcripts, tool calls), with pauses so the
// dashboard animates like the real run. Use it to test the backend and rehearse the screen.
//   node scripts/simulate-demo.mjs              (against http://localhost:3000)
//   WEBHOOK_BASE_URL=https://x.vercel.app node scripts/simulate-demo.mjs
//   node scripts/simulate-demo.mjs --fast       (no pauses)
//   node scripts/simulate-demo.mjs --no-answer  (Jan misses the call -> Mila is called)
import { env } from "./env.mjs";

const base = env.WEBHOOK_BASE_URL ?? "http://localhost:3000";
const fast = process.argv.includes("--fast");
const noAnswer = process.argv.includes("--no-answer");
const tenantPhone = env.DEMO_TENANT_PHONE ?? "+490000000003";
const tenantCall = { id: `sim-tenant-${Date.now()}`, startedAt: new Date().toISOString(), customer: { number: tenantPhone } };
const wait = (s) => (fast ? Promise.resolve() : new Promise((r) => setTimeout(r, s * 1000)));

async function send(message) {
  const res = await fetch(`${base}/api/vapi`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Vapi-Secret": env.VAPI_WEBHOOK_SECRET ?? "" },
    body: JSON.stringify({ message }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${message.type} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const say = (call, role, transcript) => send({ type: "transcript", transcriptType: "final", role, transcript, call });
async function tool(call, name, args) {
  const r = await send({ type: "tool-calls", call, toolCallList: [{ id: `tc-${Date.now()}`, type: "function", function: { name, arguments: args } }] });
  const res = r.results?.[0];
  if (res?.error) throw new Error(`${name}: ${res.error}`);
  const out = JSON.parse(res.result);
  console.log(`  ${name} ->`, out);
  return out;
}

console.log("1. It knows who's calling");
const ar = await send({ type: "assistant-request", call: tenantCall });
const v = ar.assistantOverrides?.variableValues ?? {};
await send({ type: "status-update", status: "in-progress", call: tenantCall });
await say(tenantCall, "assistant", v.first_message ?? "Hello, this is Hausmeister. How can I help?");
await wait(3);
const unit = v.unit ?? "3B";

console.log("2. Smart triage");
await say(tenantCall, "user", "Yes. Water is dripping from my ceiling.");
await wait(2);
await say(tenantCall, "assistant", "I'm sorry. Is it still dripping, and is it near a light or a socket?");
await wait(3);
await say(tenantCall, "user", "Still dripping, and it's right next to the ceiling light.");
await wait(1);
const ticket = await tool(tenantCall, "create_ticket", { unit, issue_type: "leak", urgency: "urgent", summary: "Water dripping from the ceiling next to the light fixture" });
await say(tenantCall, "assistant", "Please don't touch the light. I've just texted you a link. Could you snap a quick photo?");

console.log("3. It looks at the damage");
await tool(tenantCall, "send_photo_link", { ticket_id: ticket.ticket_id });
await wait(4);
await fetch(`${base}/api/photo/${ticket.ticket_id}?simulate=1`, { method: "POST", headers: { "X-Admin-Key": env.DASHBOARD_ADMIN_KEY ?? "" } });
await say(tenantCall, "user", "Okay, sent.");
const photo = await tool(tenantCall, "check_photo", { ticket_id: ticket.ticket_id });
if (photo.uploaded) await say(tenantCall, "assistant", `${photo.assessment} ${photo.safety_advice}`);
await wait(3);

console.log("4. The context moment");
const ctx = await tool(tenantCall, "get_building_context", { unit, issue_type: "leak" });
await say(tenantCall, "assistant", ctx.pattern_note || "No similar reports in your stack.");
await wait(4);

console.log("5. It calls the contractor");
const d = await tool(tenantCall, "dispatch_contractor", { ticket_id: ticket.ticket_id, trade: "plumber" });
if (!d.started) throw new Error(d.message);
await say(tenantCall, "assistant", `I'm calling ${d.contractor_name} now, and I'll text you the time as soon as it's booked.`);
await send({ type: "status-update", status: "ended", call: tenantCall });

const state = await (await fetch(`${base}/api/dashboard`)).json();
const t = state.tickets.find((x) => x.id === ticket.ticket_id);
let dispatcherCall = { id: t.dispatcher_call_id, assistantOverrides: { variableValues: { agent: "dispatcher" } } };

if (noAnswer) {
  console.log("   (Jan doesn't pick up)");
  await send({ type: "status-update", status: "ringing", call: dispatcherCall });
  await wait(3);
  await send({ type: "end-of-call-report", endedReason: "customer-did-not-answer", call: dispatcherCall });
  const s2 = await (await fetch(`${base}/api/dashboard`)).json();
  const t2 = s2.tickets.find((x) => x.id === ticket.ticket_id);
  dispatcherCall = { id: t2.dispatcher_call_id, assistantOverrides: { variableValues: { agent: "dispatcher" } } };
  console.log("   next contractor:", t2.contractor_name);
}

await send({ type: "status-update", status: "ringing", call: dispatcherCall });
await wait(2);
await send({ type: "status-update", status: "in-progress", call: dispatcherCall });
const slots = (await (await fetch(`${base}/api/dashboard`)).json()).tickets.find((x) => x.id === ticket.ticket_id).offered_slots;
await say(dispatcherCall, "assistant", `Hi, this is Hausmeister calling about a job at Building B. Water through the ceiling in ${unit}, and you should start in ${ctx.visit_first} upstairs. I can offer ${slots.map((s) => s.label).join(", or ")}. Which works?`);
await wait(4);
await say(dispatcherCall, "user", "The first one works.");
const booked = await tool(dispatcherCall, "confirm_slot", { ticket_id: ticket.ticket_id, slot_id: slots[0].id });
await say(dispatcherCall, "assistant", "Perfect, you're booked. I've texted the tenant. Thanks!");
await send({ type: "status-update", status: "ended", call: dispatcherCall });

console.log("6. Loop closed:", booked.confirmed ? "booked" : booked.message);
