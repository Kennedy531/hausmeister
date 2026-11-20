// Sends a fake Vapi tool-calls payload to the webhook, like Vapi would.
//   node scripts/fake-tool-call.mjs lookup_tenant '{}' +491510000003
//   node scripts/fake-tool-call.mjs create_ticket '{"unit":"3B","issue_type":"leak","urgency":"urgent","summary":"Water dripping from the ceiling"}'
import { env } from "./env.mjs";

const [name = "lookup_tenant", args = "{}", phone = env.DEMO_TENANT_PHONE ?? "+490000000003", callId = "fake-call-1"] = process.argv.slice(2);
const base = env.WEBHOOK_BASE_URL ?? "http://localhost:3000";

const res = await fetch(`${base}/api/vapi`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Vapi-Secret": env.VAPI_WEBHOOK_SECRET ?? "" },
  body: JSON.stringify({
    message: {
      type: "tool-calls",
      call: { id: callId, startedAt: new Date().toISOString(), customer: { number: phone } },
      toolCallList: [{ id: "tc-" + Date.now(), type: "function", function: { name, arguments: JSON.parse(args) } }],
    },
  }),
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
