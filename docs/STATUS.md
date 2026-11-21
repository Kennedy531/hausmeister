# Hausmeister: setup and status

Last updated: Saturday 21 November 2026, about 01:50 (Amsterdam time), after the first complete booking over real phones.

This is the one place that says what is set up where, what has been proven to work, what is broken, and what is left before the demo. Secrets and phone numbers are **not** in this file: they live in each person's `.env.local`, in Vercel and in the Supabase database.

## At a glance

| Part | Status |
|---|---|
| Inbound call on the Dutch number | ✅ Works |
| Caller recognised and greeted by name | ✅ Works (both of Kennedy's phones) |
| Triage, ticket created | ✅ Works |
| Pattern moment ("third leak in your stack, plumber goes to 4B first") | ✅ Works |
| Outbound call to the contractor | ✅ Works (after the Telnyx fix, see [Fixed tonight](#fixed-tonight)) |
| Contractor accepts a slot, ticket booked | ✅ Works: ticket 1013 booked about 1.5 minutes after the call started |
| Fallback to the second plumber | ✅ Works (Jan's call ended early, so Mila was called and booked) |
| Agents follow the speaker's language | ✅ Works: the dispatcher opened in Dutch and switched to English when asked |
| Dashboard data and live transcript | ✅ Works (not yet checked on the big screen) |
| Confirmation text, neighbour text (SMS) | ⏸️ Not sent: the Twilio trial (account made Saturday, number +1 478 834 9568) refused even the sign-up number (error 21608) and won't verify other Dutch numbers. Twilio isn't configured on Vercel, so texts are logged on the ticket and shown on the dashboard instead |
| Photo upload with vision | ⛔ Switched off for the demo: the link goes out by SMS, and the Twilio trial can't text Dutch numbers. The tools still exist; `agents/config.mjs` says how to turn them back on |
| Emergency path (gas, fire) | ❔ Not tested live |
| German tenant call | Not needed: the demo is English and Maastricht-based now (German still works if a caller speaks it) |
| Tenant availability ("when are you home?") | ✅ Live since Saturday morning: deployed from `main`, migration 002 run, agents synced. Not yet tried on a real call |

Measured call costs (from Vapi, Friday night tests): tenant call about **$0.07**, dispatcher call about **$0.05–0.09**. Useful for the "what does a call cost?" question.

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
- `main`: everything merged so far, plus tonight's setup fixes, docs and prompt changes.
- `dev`: Tadiwa's working branch, **3 commits ahead of `main`** (tenant availability window, see [Pending](#pending-on-dev-tenant-availability)). Production is currently built from an older `dev` commit.
- `track-a-calls`, `track-b-data`: no longer used (see `docs/TRACKS.md`).

### Vercel: project `hausmeister` (account `kennedy531`, Hobby)
- Domain: `hausmeister-green.vercel.app`.
- 17 environment variables: the Supabase URL and keys, OpenAI, Vapi key, phone number id, both assistant ids, webhook secret, voice and model settings, dashboard admin key, time zone and `PUBLIC_BASE_URL`.
- The production deploy was made from `dev` by another Claude session ("by claude"), then redeployed to pick up the assistant ids. **Whoever deploys last decides what is live.**
- Redeploying from the Vercel dashboard asks for Kennedy's two-factor code.
- The secrets were saved as type "Config", so anyone added to the project can read them. Fine on a personal account.

### Supabase: project `hausmeister` (ref `emwupfxksbozowyznkrb`, West EU / Paris, free plan)
- Applied: `supabase/schema.sql` + `supabase/seed.sql`, then `supabase/migrations/001_dutch_and_translation.sql`.
- Also applied: `supabase/migrations/002_tenant_availability.sql` (tenant time window, three slots per contractor a day).
- `schema.sql` grants the API roles table access itself, because new Supabase projects no longer do that automatically.
- **The demo building is in Maastricht** (Building B, Maasboulevard 7, mock address). All tenants are English-speaking, placeholder numbers are +31, and contractor companies have English and Dutch names (Schulte Plumbing, Brandt Electric, Maas Locksmiths, Okafor Home Services, Maas Pipe Services). This is in both the live database and `supabase/seed.sql`.
- **Demo data changed by hand** (not in the seed files):
  - Two tenants named **Kennedy** in flat **3B**, with Kennedy's two mobiles (…9862 and …7117), English. The first replaced the seeded "Tadiwa".
  - **All five contractors** (Jan, Mila, Ingrid, Kai, Olu) currently ring **Kennedy's …7117**. **Call in as the tenant from …9862** (the only number Twilio might ever text).
  - Jan and Mila (the plumbers) are set to Dutch.
- Before each rehearsal: **Reset demo** on the dashboard, or `select reset_demo();`. It removes call-created tickets, re-dates the history and creates fresh free slots for today. Tenants and contractors are kept.

### Vapi: Kennedy's org
- Assistants, created and updated by `node scripts/sync-agents.mjs`:
  - `Hausmeister Tenant Line`: `03c11232-38a7-464f-ad9c-006de9ebe689`
  - `Hausmeister Dispatcher`: `c197990d-ebf1-4e1f-ae3d-b95947193b14`
- Last synced from `main` on Saturday at about 09:05: language-following, "ask again" and the tenant availability question.
- Voice: ElevenLabs `eleven_flash_v2_5`, voice `sarah`. Model: `gpt-4.1-mini`. Transcriber: Deepgram `nova-3`, `multi` (understands English, German and Dutch).
- The Dutch number has **two** Vapi entries, and both point at the webhook with no fixed assistant:
  - `4e36f1a0-…` "Fysio Receptie (SIP)": the BYO number entry. It is `VAPI_PHONE_NUMBER_ID`, used for **outbound** dispatcher calls. `sync-agents.mjs` updates this one.
  - `c8a2b7f1-…` "Fysio Receptie (SIP Direct)", `sip:evafysio@sip.vapi.ai`: the carrier forwards **inbound** calls here. `sync-agents.mjs` does **not** update it; it was changed by hand.
- SIP trunk credential `c2d3f6db-…` "Telnyx SIP Trunk": two gateways (185.246.41.140/.141, Telnyx EU), inbound and outbound enabled, **tech prefix `7391`** (must match Telnyx).

### Telnyx: the account that owns +31 85 083 5699 (not Kennedy's empty personal Telnyx account)
- SIP connection **"Kyrix"** (id `3011813459068192313`, type FQDN → `sip.vapi.ai:5060`).
- Outbound calls authentication: **IP Addresses**, `44.229.228.186` and `44.238.177.138` (Vapi's US SIP servers), IP authentication method **Tech Prefix `7391`**. No SIP password is involved.
- Outbound voice profile **"Default"** (Global, rate deck), attached to the Kyrix connection. Allowed destinations: North America (as before) plus **Netherlands +31** and **Germany +49**.
- Debugging → SIP Call Flow Tool shows every call with its SIP reason. It's the quickest way to see why a call failed.

### Twilio (SMS): tried, not used for the demo
- A trial account exists, and its account id, token and number are in Kennedy's `.env.local`. They are **not** in Vercel, so the live app logs texts instead of sending them.
- To make texts work later: upgrade the account (removes the verified-numbers limit), ideally get a Dutch or alphanumeric sender, add the three `TWILIO_*` settings in Vercel and redeploy.

### Not set up yet
- `ONCALL_MANAGER_PHONE`, `DEMO_NEIGHBOUR_PHONE`, `NEXT_PUBLIC_TYPICAL_RESPONSE`.

## Tenant availability (now live)

Tadiwa's commits make the tenant agent ask *"When are you home today?"* and only offer and book contractor slots in that window (three slots per contractor a day). Rollout steps, all done by Saturday ~09:05 (keep this order for any future migration):
1. Run `supabase/migrations/002_tenant_availability.sql` in the Supabase SQL editor. **Do this before deploying**, or the new code will likely fail when it writes tickets or slots.
2. Merge `dev` into `main` and deploy.
3. Run `node scripts/sync-agents.mjs` from that same code, so the prompts match.
4. Reset the demo (to get three slots per contractor), then do a full test call.

## Fixed tonight

### Outbound calls failed (fixed at about 01:25)
Three Telnyx problems, each with its own error:
1. `SIP 407 proxy authentication required`: the Kyrix connection required a login Vapi didn't have. Fixed with IP authentication for Vapi's servers, plus tech prefix `7391` on both Telnyx and Vapi.
2. Telnyx wouldn't attach an outbound voice profile until outbound authentication was configured. Fixed by attaching "Default" after step 1.
3. `403 Dialed number …`, Q.850 cause 21: the profile only allowed North America. Fixed by allowing the Netherlands and Germany.

If Vapi ever moves to an EU org, its SIP server is `63.182.83.170`, and that IP has to be added in Telnyx too. `scripts/set-sip-auth.mjs` is only needed if the connection is switched back to a username and password login.

### Inbound calls reached the Fysio receptionist
The carrier forwards the number to the SIP Direct entry, which still had the Fysio assistant. Fixed by pointing that entry at the webhook too.

### Dispatcher prompt
- It now answers in whatever language the contractor speaks (it used to speak Dutch "for the whole call"). The tenant agent does the same for English, German and Dutch.
- It no longer says "I've texted the tenant" unless the text was really sent.
- It asks again on short or unclear answers instead of hanging up. A misheard "none" had ended a call.

## Known issues

1. **Hanging up on a dispatcher call makes the app call the next contractor.** That's the intended fallback, but while every contractor rings the same test phone, it rings again. To stop all dispatching, press **Reset demo**.
2. **Voicemail:** in one test the dispatcher pitched the job to an answering machine. The contractor on stage should answer quickly; Vapi's voicemail detection is worth turning on.
3. **Late-night slots:** slots are 2 and 5 hours after the last reset, so a reset at night offers times like "3 to 5 in the morning". Reset in the morning before rehearsing.
4. **The SIP Direct entry isn't managed by the sync.** If the webhook address ever changes, update `c8a2b7f1-…` by hand too.
5. ~~The mock address was hard to pronounce~~ ("Beispielweg" came out as "Bayspielweg"). Now Maasboulevard, Maastricht.

## What's left before the demo

### Must do
1. ~~Twilio for texts~~: dropped for the demo (see the Twilio section). On stage, point at "Tenant notified" on the dashboard and say it goes out by SMS in production.
2. **Demo cast and numbers.** Decide who calls as the tenant (the plan says Tadiwa), then in Supabase:
   - put the right name and number on the 3B tenant
   - Jan → Emmanuel's phone, Mila → a spare phone (so the fallback is visible), and the other contractors back to something sensible
   - decide Jan's language: Dutch with English subtitles on the dashboard, or English
   - set `ONCALL_MANAGER_PHONE` (local and Vercel).
3. **One branch, one deploy.** Agree with Tadiwa which branch is final, run migration 002 if it's `dev`, merge into `main`, redeploy, then re-run `sync-agents.mjs` from that code.
4. **Rehearse 5 or more times in the hall** (Reset before each), test in the noise, record the backup video around 08:30, code freeze at 09:00.

### Test once
5. ~~Photo moment~~: switched off for the demo.
6. Emergency path: "I smell gas" should give the safety script and an escalated ticket, with no dispatch.
7. Switching language mid-call (English ↔ Dutch).
8. The dashboard on the big screen with the admin key: the timer stops at booking, the pattern highlight shows.
9. The "ask again" fix: answer the dispatcher with a single short word.

### Pitch
10. Slides, script and Q&A (Emmanuel). Use the measured call costs above, and confirm the pitch format with the organisers.

### Nice to have
- Voicemail detection on the dispatcher.

## How to

```bash
npm install
scripts/set-env.sh                 # asks for each missing key with hidden input, saves to .env.local
npm run dev                        # local app on http://localhost:3000
node scripts/simulate-demo.mjs     # the six demo moments against the webhook, without phones
node scripts/sync-agents.mjs       # push agent prompts and settings to Vapi
```

- **Change an agent's prompt:** edit `agents/`, then run `node scripts/sync-agents.mjs` from the same code that is deployed, so prompts and code match.
- **Test the dispatcher without a tenant call:** send `create_ticket` (unit 3B, leak) and then `dispatch_contractor` (plumber) to the webhook with the secret, as `scripts/fake-tool-call.mjs` does. This rings the contractor's phone for real.
- **Check what happened on a call:** Vapi dashboard → Logs, or `GET https://api.vapi.ai/call?limit=5`. The ticket timeline in Supabase (`ticket_events`) records each dispatch attempt, booking and text. Telnyx's SIP Call Flow Tool shows the phone-network side.

## After the hackathon: give the number back to Fysio
1. On Vapi entry `c8a2b7f1-…` (SIP Direct): set the assistant back to **Fysio Receptie (NL)** `ade56fb6-a171-41ce-ae38-6548356783ce` and remove the server URL.
2. On Vapi entry `4e36f1a0-…`: remove the server URL.
3. In Telnyx, decide whether to keep the Kyrix connection's outbound settings (IP authentication, Default profile, NL/DE destinations) or undo them.
