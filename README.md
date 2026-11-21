# Hausmeister

An AI voice caretaker. A tenant calls; before the call ends, the agent has triaged the problem, checked the building's history, booked a contractor by phone and emailed the tenant the confirmed time.

> "Tenants don't want a ticket number. They want the plumber booked."

> **Current status, accounts and the morning checklist:** [`docs/STATUS.md`](docs/STATUS.md) · **Live demo script:** [`docs/DEMO.md`](docs/DEMO.md) · **Partner connectors (contractor live, internet and energy spec):** [`docs/CONNECTORS.md`](docs/CONNECTORS.md)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the keys (ask your teammate for the shared values)
npm run dev
```

1. **Database.** In the Supabase SQL editor run `supabase/schema.sql`, then `supabase/seed.sql`, then your own `supabase/phones.local.sql` (copy it from `phones.example.sql`, add the real numbers exactly as they show up as caller ID; it is git-ignored).
2. **Try the whole loop without phones.** With `npm run dev` running: `node scripts/simulate-demo.mjs` plays the six demo moments against the webhook (add `--no-answer` to see a missed call escalate, `--fast` to skip pauses). Watch it on `http://localhost:3000/?key=<DASHBOARD_ADMIN_KEY>`.
3. **Phones.** Deploy (or `ngrok http 3000`) and set `PUBLIC_BASE_URL`, then `node scripts/sync-agents.mjs`. It creates or updates both Vapi assistants from `agents/` and points the phone number at `/api/vapi`, so inbound calls are matched to the tenant by caller ID before the agent says hello. Put the printed assistant ids in `.env.local` and on Vercel.
4. **Before every rehearsal:** press *Reset demo* on the dashboard (or `select reset_demo();`). It deletes call-created tickets and transcripts, re-dates the seed history and gives every contractor three fresh slots today. Phones are kept.

Without Gmail or Vapi keys, the email and the outbound call are logged instead of sent, so the rest of the loop still runs.

## Demo safety nets

- **Dispatch guard:** `dispatch_contractor` refuses (with a reason the agent says) unless the ticket is open, not an emergency, and a contractor has a free slot. Nobody's phone rings by accident.
- **No answer:** if a dispatcher call ends without a booking, the next contractor of that trade by rating is called; with nobody left the ticket escalates to the on-call manager.
- **Emergencies:** gas, fire, sparks or water on electrics get the safety script, an escalated ticket and an SMS to `ONCALL_MANAGER_PHONE`; never a normal dispatch.
- **Backup button:** on the dashboard (`?key=`), *Backup: dispatch now* runs the same guarded dispatch if the agent stalls.
- **`confirm_slot`** only books a free slot of the contractor that was called, atomically.
- **Times** are always spoken and texted in `DEMO_TIME_ZONE`, never UTC.

## Layout

| Path | What |
|---|---|
| `src/lib/contract.ts` | The 7 tools the voice agents call: names, inputs, outputs |
| `src/lib/tools/` | Tool implementations: `index.ts` (handlers), `data.ts` (queries, pattern sentence), `dispatch.ts` (guard, fallback, escalation) |
| `src/lib/vapi.ts` | Starts the outbound dispatcher call |
| `src/app/api/vapi/` | Webhook for both agents: caller-ID match, tool calls, live transcript, call-ended fallback |
| `src/app/page.tsx` | Big-screen dashboard: timer, steps, building stack, ticket, live transcript |
| `src/app/api/demo/` | Reset and backup dispatch (need `DASHBOARD_ADMIN_KEY`) |
| `agents/` | Voice agent prompts and tool definitions (pushed with `scripts/sync-agents.mjs`) |
| `supabase/` | Schema (incl. pattern rule, slot booking and reset as SQL functions) and demo seed data |
| `scripts/` | `sync-agents`, `simulate-demo`, `fake-tool-call` |
| `docs/STATUS.md` | What is set up where, what works, known issues, next steps |
| `docs/TRACKS.md` | The original two-track split (outdated) |

## Before the demo, check on a real call

These Vapi details couldn't be verified without an account; the webhook already accepts the likely variants, but confirm them in the first test call:
- the greeting uses the caller's name (variables from `assistant-request` reach `firstMessage`);
- outbound calls reach Dutch numbers (Vapi's free numbers may be US-only; import a Twilio number if not);
- `sync-agents.mjs` is accepted as-is (`endCall` tool type, Deepgram `nova-3` with `multi` language).
