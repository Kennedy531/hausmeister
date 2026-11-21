# Hausmeister: setup and status

Last updated: Saturday 21 November 2026, about 01:35 (Amsterdam time), after outbound calls were fixed.

This is the one place that says what is set up where, what has been proven to work, what is broken, and what to do next. Secrets and phone numbers are **not** in this file: they live in each person's `.env.local`, in Vercel and in the Supabase database.

## At a glance

| Part | Status |
|---|---|
| Inbound call on the Dutch number | ✅ Works (real call, 01:03) |
| Caller recognised and greeted by name | ✅ Works |
| Triage, ticket created | ✅ Works |
| Pattern moment ("third leak in your stack, plumber goes to 4B first") | ✅ Works (live test) |
| Dashboard data and live transcript | ✅ Works |
| Dispatch logic (pick contractor, fallback to the second plumber, escalate) | ✅ Works |
| **Outbound call to the contractor** | ✅ Works since about 01:25 (the dispatch phone rang twice, calls of 13 s and 32 s), after the Telnyx fix below |
| Confirmation text (SMS) | ⏸️ Not set up: no Twilio yet. Texts are logged instead of sent |
| Photo upload with vision | ❔ Not tested live |
| German / Dutch calls | ❔ Not tested live |

## Live addresses

| What | Where |
|---|---|
| App and dashboard | https://hausmeister-green.vercel.app. Open `/?key=<DASHBOARD_ADMIN_KEY>` to get the demo buttons (Reset, backup dispatch) |
| Vapi webhook | https://hausmeister-green.vercel.app/api/vapi (rejects requests without the secret) |
| Phone line | +31 85 083 5699 |

## Accounts and ids

None of these ids are secret. Keys are in `.env.local` and in Vercel only.

### GitHub: `Kennedy531/hausmeister` (private)
- Collaborators: `Tadiwa-M`, `emmanuel418`.
- `main`: the merged prototype plus setup fixes.
- `dev`: one commit ahead of `main` (neighbour access text, Dutch-speaking plumber with live English subtitles, impact card). **Production is currently built from `dev`.**
- `track-a-calls`, `track-b-data`: no longer used (see `docs/TRACKS.md`).

### Vercel: project `hausmeister` (account `kennedy531`, Hobby)
- Domain: `hausmeister-green.vercel.app`.
- 17 environment variables are set: the Supabase URL and keys, OpenAI, Vapi key, phone number id, both assistant ids, webhook secret, voice and model settings, dashboard admin key, time zone and `PUBLIC_BASE_URL`.
- The current production deploy was made from `dev` by another Claude session (Vercel shows it as "by claude"), then redeployed once to pick up the assistant ids. **Whoever deploys last decides what is live.** Agree on one branch.
- The secrets were saved as type "Config", so anyone added to the Vercel project can read them. Fine on a personal account.
- Redeploying from the Vercel dashboard asks for Kennedy's two-factor code.

### Supabase: project `hausmeister` (ref `emwupfxksbozowyznkrb`, West EU / Paris, free plan)
- Applied: `supabase/schema.sql` + `supabase/seed.sql` (from `main`), then `dev`'s `supabase/migrations/001_dutch_and_translation.sql`.
- `schema.sql` now grants the API roles table access itself, because new Supabase projects no longer do that automatically.
- **Demo data changed by hand tonight** (not in the seed files):
  - The 3B tenant is now **Kennedy** with Kennedy's mobile, English.
  - **All five contractors** (Jan, Mila, Ingrid, Kai, Olu) use the same test "dispatch" phone, so any trade rings a real phone.
  - Jan and Mila (the plumbers) speak Dutch, from `dev`'s migration.
- Before each rehearsal: `select reset_demo();` or the dashboard's Reset button. It removes call-created tickets, re-dates the history and creates two free slots per contractor (2 and 5 hours from now). Tenants and contractors are kept.

### Vapi: Kennedy's org
- Assistants, created and updated by `node scripts/sync-agents.mjs`:
  - `Hausmeister Tenant Line`: `03c11232-38a7-464f-ad9c-006de9ebe689`
  - `Hausmeister Dispatcher`: `c197990d-ebf1-4e1f-ae3d-b95947193b14`
- The Dutch number has **two** Vapi entries, and both now point at the webhook with no fixed assistant:
  - `4e36f1a0-…` "Fysio Receptie (SIP)": the BYO number entry. It is `VAPI_PHONE_NUMBER_ID`, used for **outbound** dispatcher calls. `sync-agents.mjs` updates this one.
  - `c8a2b7f1-…` "Fysio Receptie (SIP Direct)", `sip:evafysio@sip.vapi.ai`: the carrier forwards **inbound** calls here. `sync-agents.mjs` does **not** update it; it was changed by hand.
- SIP trunk credential `c2d3f6db-…` "Telnyx SIP Trunk": two gateways (185.246.41.140/.141, Telnyx EU), inbound and outbound enabled, **tech prefix `7391`** (must match Telnyx).

### Telnyx: the account that owns +31 85 083 5699 (not Kennedy's empty personal Telnyx account)
- SIP connection **"Kyrix"** (id `3011813459068192313`, type FQDN → `sip.vapi.ai:5060`).
- Outbound calls authentication: **IP Addresses**, `44.229.228.186` and `44.238.177.138` (Vapi's US SIP servers), IP authentication method **Tech Prefix `7391`**. No SIP password is involved.
- Outbound voice profile: **"Default"** (Global, rate deck), attached to the Kyrix connection. Allowed destinations: North America (as before) plus **Netherlands +31** and **Germany +49**.
- Telnyx's call log (Debugging → SIP Call Flow Tool) shows every inbound and outbound call with the SIP reason, which is the quickest way to see why a call failed.
- Voice: ElevenLabs `eleven_flash_v2_5`, voice `sarah`. Model: `gpt-4.1-mini`. Transcriber: Deepgram `nova-3`, `multi`.

### Not set up yet
- **Twilio** (SMS): needs an account SID, auth token and sending number.
- `ONCALL_MANAGER_PHONE`, `DEMO_NEIGHBOUR_PHONE`, `NEXT_PUBLIC_TYPICAL_RESPONSE` (the last two are new on `dev`).

## Known issues

### 1. ~~Outbound calls failed~~ (fixed at about 01:25)
Three things were wrong, and each produced its own error:
1. `SIP 407 proxy authentication required`: the Kyrix connection required a SIP login that Vapi didn't have. Fixed by switching it to IP authentication for Vapi's servers, plus tech prefix `7391` on both Telnyx and Vapi.
2. Telnyx wouldn't attach an outbound voice profile until the connection's outbound authentication was configured. Fixed by attaching "Default" after step 1.
3. `403 Dialed number … (associated …)`, Q.850 cause 21: the profile only allowed North America. Fixed by allowing the Netherlands and Germany.

If Vapi ever moves to an EU org, its SIP server is `63.182.83.170` instead, and that IP has to be added in Telnyx. `scripts/set-sip-auth.mjs` is only needed if the connection is ever switched back to a username and password login.

### 4. A dispatcher call that ends without a booking makes the app call the next contractor
That is intended (the fallback), but during testing it means hanging up on Jan makes Mila's phone ring next. Right now every contractor uses the same test phone, so it rings again. To stop all dispatching, press **Reset demo** (or `select reset_demo();`): it removes the call-created tickets, so there's nothing left to dispatch for.

### 2. Production runs `dev`, `main` is one commit behind
Fine for tonight. Agree on one branch for the demo, merge it into `main` and deploy from `main`.

### 3. The SIP Direct entry isn't managed by the sync
If the webhook address ever changes, update `c8a2b7f1-…` by hand too, or calls go nowhere.

## How to

```bash
npm install
scripts/set-env.sh                 # asks for each missing key with hidden input, saves to .env.local
npm run dev                        # local app on http://localhost:3000
node scripts/simulate-demo.mjs     # the six demo moments against the webhook, without phones
node scripts/sync-agents.mjs       # push agent prompts and settings to Vapi
```

- **Change an agent's prompt:** edit `agents/`, then run `node scripts/sync-agents.mjs` **from the same branch that is deployed**, so prompts and code match.
- **Test the dispatcher without a tenant call:** send `create_ticket` (unit 3B, leak) and then `dispatch_contractor` (plumber) to the webhook with the secret, as `scripts/fake-tool-call.mjs` does. This rings the test dispatch phone for real.
- **Check what happened on a call:** Vapi dashboard, then Logs, or `GET https://api.vapi.ai/call?limit=5`. The ticket timeline in Supabase (`ticket_events`) records each dispatch attempt and its error.

## After the hackathon: give the number back to Fysio
1. On Vapi entry `c8a2b7f1-…` (SIP Direct): set the assistant back to **Fysio Receptie (NL)** `ade56fb6-a171-41ce-ae38-6548356783ce` and remove the server URL.
2. On Vapi entry `4e36f1a0-…`: remove the server URL.

## Morning checklist (Saturday)

1. **Full end-to-end test:** call the line, report a leak in 3B, answer the dispatcher on the second phone and **accept a slot**. Check that the dashboard shows the booking and the timer stops. Outbound calls now connect, but a booking hasn't been completed yet.
2. **Decide the demo cast:** who calls as the tenant (Kennedy or Tadiwa) and whose phone plays Jan. Update the tenant name and number and the contractor numbers in Supabase. Give Mila a different phone from Jan, so the fallback is visible.
3. **Pick the deploy branch** (`dev` or `main`), merge, redeploy, then re-run `sync-agents.mjs` from it.
4. **Twilio** for the confirmation text, and verify the demo phones in the trial.
5. **Optional demo upgrade:** the tenant agent asks *"When are you home today?"* and the dispatcher only offers the plumber slots that fit. It touches the tenant prompt and the dispatch tool, so agree with Tadiwa first.
6. Test German and Dutch calls and the photo moment.
7. Rehearse at least 5 times (Reset before each), record the backup video, code freeze at 09:00.
