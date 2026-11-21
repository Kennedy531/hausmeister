// Plays the whole six-moment demo against the webhook WITHOUT phones: the same payloads
// Vapi would send (assistant-request, transcripts, tool calls), with pauses so the
// dashboard animates like the real run. Use it to test the backend and rehearse the screen.
//   node scripts/simulate-demo.mjs              (against http://localhost:3000)
//   WEBHOOK_BASE_URL=https://x.vercel.app node scripts/simulate-demo.mjs
//   node scripts/simulate-demo.mjs --fast       (no pauses)
//   node scripts/simulate-demo.mjs --no-answer  (Jan misses the call -> the ticket is escalated)
import { env } from "./env.mjs";

const base = env.WEBHOOK_BASE_URL ?? "http://localhost:3000";
const fast = process.argv.includes("--fast");
const noAnswer = process.argv.includes("--no-answer");
const tenantPhone = env.DEMO_TENANT_PHONE ?? "+310000000003";
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
await say(tenantCall, "assistant", "Please don't touch the light.");

console.log("4. The context moment");
const ctx = await tool(tenantCall, "get_building_context", { unit, issue_type: "leak" });
await say(tenantCall, "assistant", ctx.pattern_note || "No similar reports in your stack.");
await wait(4);

console.log("5. It calls the contractor");
// "When are you home today?" The tenant is home from about 2.5 hours from now, so the
// earliest slot (in 1 hour) is filtered out and only the later ones are offered.
const homeFrom = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hour12: false })
  .format(new Date(Math.ceil((Date.now() + 2.5 * 3600e3) / 3600e3) * 3600e3));
await say(tenantCall, "assistant", "When are you home today?");
await wait(2);
await say(tenantCall, "user", `From ${homeFrom}.`);
const d = await tool(tenantCall, "dispatch_contractor", { ticket_id: ticket.ticket_id, trade: "plumber", available_from: homeFrom });
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
// The plumber speaks Dutch: the dispatcher briefs him in Dutch (the dashboard subtitles it in English).
await say(dispatcherCall, "assistant", `Hoi, met Hausmeister. Water door het plafond in ${unit}, en u begint het best in ${ctx.visit_first} erboven. Ik kan ${slots.map((s) => s.label).join(" of ")} aanbieden. Wat past?`);
await wait(4);
await say(dispatcherCall, "user", "De eerste is prima.");
const booked = await tool(dispatcherCall, "confirm_slot", { ticket_id: ticket.ticket_id, slot_id: slots[0].id });
await say(dispatcherCall, "assistant", "Top, u staat ingepland. Ik heb de huurder een sms gestuurd. Bedankt!");
await send({ type: "status-update", status: "ended", call: dispatcherCall });
// What Vapi reports when each call ends (cost in USD), for the impact card.
await send({ type: "end-of-call-report", endedReason: "customer-ended-call", cost: 0.21, call: tenantCall });
await send({ type: "end-of-call-report", endedReason: "assistant-ended-call", cost: 0.14, call: dispatcherCall });

console.log("6. Loop closed:", booked.confirmed ? "booked" : booked.message);
