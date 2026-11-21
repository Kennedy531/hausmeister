#!/usr/bin/env node
// Gives Vapi the SIP username and password it needs to place OUTBOUND calls through
// the Telnyx trunk (the dispatcher's call to the contractor). Without them Telnyx
// answers "407 proxy authentication required".
//
//   node scripts/set-sip-auth.mjs [vapi-credential-id]
//
// Asks for the username and password you set on the Telnyx SIP connection
// (Authentication and routing → Outbound calls authentication → Credentials).
// The password is typed hidden and sent only to Vapi; nothing is written to disk.
import { createInterface } from "node:readline";
import { env } from "./env.mjs";

const CREDENTIAL_ID = process.argv[2] ?? "c2d3f6db-a4fd-4922-8d12-7ab57b2705a3"; // "Telnyx SIP Trunk"
if (!env.VAPI_API_KEY) {
  console.error("VAPI_API_KEY is missing in .env.local");
  process.exit(1);
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function vapi(method, path, body) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const current = await vapi("GET", `/credential/${CREDENTIAL_ID}`);
console.log(`Vapi credential: "${current.name}" (${current.provider}), ${current.gateways?.length ?? 0} gateways`);

const authUsername = await ask("Telnyx SIP username: ");
const authPassword = await ask("Telnyx SIP password (hidden): ", true);
if (!authUsername || !authPassword) {
  console.error("Both are needed; nothing changed.");
  process.exit(1);
}

const updated = await vapi("PATCH", `/credential/${CREDENTIAL_ID}`, {
  provider: current.provider,
  name: current.name,
  gateways: current.gateways,
  outboundAuthenticationPlan: {
    authUsername,
    authPassword,
    sipRegisterPlan: { realm: "sip.telnyx.com" },
  },
});

const plan = updated.outboundAuthenticationPlan ?? {};
console.log(
  plan.authUsername === authUsername
    ? `✓ Saved. Vapi will log in as "${authUsername}" for outbound calls.`
    : "! Vapi accepted the request but didn't echo the username back; check the trunk in the Vapi dashboard.",
);
