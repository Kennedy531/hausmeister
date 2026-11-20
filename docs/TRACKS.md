# Two build tracks

Hausmeister is built by two people at once, each with their own Claude session, on separate branches. The tracks own **different files**, so merges are clean. They meet at a small set of shared files with stubs already in place, so each track can run end to end before the other one is finished.

The full product and demo plan lives in the team doc "Reltix Track — Build & Pitch Plan". This file is only about who builds what.

| | Track A: Calls | Track B: Data & screens |
|---|---|---|
| Who | Kennedy | Tadiwa |
| Branch | `track-a-calls` | `track-b-data` |
| Owns | Everything a phone call touches: Vapi webhook, both voice agents, outbound dispatcher call | Everything behind and around the call: database, tool logic, pattern rule, SMS, dashboard, photo page |
| Accounts | Vapi (phone number, ElevenLabs voice, OpenAI model inside Vapi) | Supabase, Twilio, OpenAI API |

## How the two tracks meet

```
tenant phone ──► Vapi tenant agent ──► POST /api/vapi  (Track A)
                                          │  parses the Vapi payload, builds ToolContext
                                          ▼
                              tools[name](input, ctx)   (Track B, src/lib/tools/index.ts)
                                          │
              ┌───────────────────────────┼─────────────────────────┐
              ▼                           ▼                         ▼
        Supabase (B)              sendSms() (B)        startDispatcherCall() (A)
              │                                                     │
              ▼                                                     ▼
        dashboard (B)                               Vapi dispatcher agent ──► contractor phone
                                                     └─ confirm_slot ──► POST /api/vapi (A) ──► tools (B)
```

The seams, all already in the repo:

- **`src/lib/contract.ts`**: names, inputs and outputs of the 7 tools.
- **`src/lib/tools/types.ts`**: `ToolContext` (caller phone, call id, call start time) and `ToolHandlers`.
- **`src/lib/tools/index.ts`**: the `tools` object Track A calls. Right now every tool is a **mock** returning data that matches the seed, so Track A can make real calls from minute one. Track B swaps mocks for real code one tool at a time.
- **`src/lib/vapi.ts` → `startDispatcherCall(brief)`**: Track B calls it from `dispatch_contractor`. Right now it is a **stub** that only logs. Track A makes it place the real call.
- **`src/lib/sms.ts` → `sendSms(to, body)`**: stub that only logs; Track B makes it real.

## File ownership

Only edit files your track owns. If you need a change in the other track's file, or in a shared file, tell the other person first and let them make it (or agree who does).

**Track A owns**
- `src/app/api/vapi/**` (the webhook)
- `src/lib/vapi.ts` (except the `DispatcherBrief` shape, which is shared)
- `agents/**` (prompts, tool definitions, the script that pushes them to Vapi)
- `scripts/**`

**Track B owns**
- `src/lib/tools/index.ts` and any new files under `src/lib/tools/` (not `types.ts`)
- `src/lib/db.ts`, `src/lib/sms.ts`, `src/lib/openai.ts`
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/dashboard/**`, `src/app/photo/**`, `src/app/api/photo/**`
- `supabase/**`
- `package.json` and `package-lock.json`. **Track A adds no npm packages**: call Vapi with `fetch`. If Track A truly needs one, ask Track B to add it, so the lockfile never conflicts.

**Shared (agree before changing)**
- `src/lib/contract.ts`, `src/lib/tools/types.ts`, `DispatcherBrief` in `src/lib/vapi.ts`
- `.env.example`, `CLAUDE.md`, `docs/TRACKS.md`

## Track A: Calls (Kennedy)

Work in this order. Each step should end with a real phone call that works.

1. **Webhook** `src/app/api/vapi/route.ts`. Next.js 16 route handler: read `node_modules/next/dist/docs/` first. It should:
   - reject requests without the shared secret (`VAPI_WEBHOOK_SECRET`)
   - handle Vapi `tool-calls` messages by building a `ToolContext` from the call, running each `tools[name](args, ctx)` and returning `{ results: [{ toolCallId, result }] }`
   - check the current Vapi server-URL docs for the exact payload and response shapes
   - test it locally with `scripts/fake-tool-call.mjs` (a fake Vapi payload sent with fetch), then expose it with ngrok or a Vercel preview.
2. **Tenant agent** `agents/tenant/`:
   - a system prompt plus tool definitions matching `contract.ts`, and `scripts/sync-agents.mjs` to create or update the agent through the Vapi API (keep the agent as code, not dashboard clicks)
   - ElevenLabs voice, OpenAI's fastest tool-calling model, street and tenant names as recognition keywords
   - flow: `lookup_tenant` at the start, then triage (2 questions max), then `get_building_context`, `create_ticket`, `dispatch_contractor`, and goodbye ("I'm calling the plumber now and will text you the time").
   - **Checkpoint 19:30** (on mocks): a real call runs the whole conversation.
3. **Dispatcher**:
   - make `startDispatcherCall()` real: Vapi `POST /call` with `VAPI_DISPATCHER_ASSISTANT_ID` and `VAPI_PHONE_NUMBER_ID`, with the brief passed as variable values
   - `agents/dispatcher/`: briefs the contractor, offers the slots, calls `confirm_slot` with the ticket id and the chosen slot id.
4. **Photo moment in the call**: `send_photo_link`, keep talking, then `check_photo`, and read out `safety_advice`.
5. **Emergency path**: gas smell, fire, or water near electrics gets a fixed safety script ("leave, call 112") and `create_ticket` with `urgency: "emergency"`. Track B's handler alerts the on-call manager.
6. **German**: the agent answers in the tenant's `language`.
7. **Latency tuning**: short sentences, filler lines before slow tools. Test in the noisy hall.

## Track B: Data & screens (Tadiwa)

1. **Database**:
   - create the Supabase project and run `supabase/schema.sql`, `seed.sql`, then `phones.local.sql` (copied from `phones.example.sql`, never committed)
   - share the env values with Track A privately (not in git).
2. **Real tools** in `src/lib/tools/` with `src/lib/db.ts` (supabase-js server client, using the secret key):
   - `lookup_tenant` matches `ctx.callerPhone`
   - `get_building_context` applies the pattern rule: open tickets with the same issue type in the same stack within 30 days; 2 or more means a pattern, and the contractor goes to the highest unit first
   - `create_ticket` stores `call_started_at = ctx.callStartedAt`, writes `ticket_events`, and texts `ONCALL_MANAGER_PHONE` on emergencies.
3. **Dashboard v1** (`src/app/page.tsx`): live ticket list and per-ticket timeline. Supabase realtime is only the trigger; it then refetches through a server route. Show the pattern highlight across the stack and the call timer, which stops at `booked_at`.
   - **Checkpoint 19:30**: a POST to the tool handlers creates a ticket that appears live.
4. **SMS** `src/lib/sms.ts` via the Twilio REST API with `fetch`, plus:
   - `confirm_slot`: book the slot, set `scheduled_at` and `booked_at`, text the tenant the plumber's name and time
   - `dispatch_contractor`: choose the best-rated contractor for the trade, set status `dispatching`, call `startDispatcherCall()` with the real brief and free slots.
5. **Photo**:
   - storage bucket SQL
   - `send_photo_link` texts `PUBLIC_BASE_URL/photo/<ticketId>`
   - an upload page for phone cameras
   - an OpenAI vision assessment saved on the ticket
   - `check_photo` returns it, or "not uploaded yet".
6. **Dashboard polish**: big call timer, pattern highlight, ticket timeline, and the mock lease rules labelled "mock data".

## Merging

Merge into `main` at every checkpoint, not only at the end, so surprises show up early:

```bash
git checkout main && git pull
git merge track-a-calls   # or track-b-data
npm run build             # must pass before pushing
git push
git checkout track-a-calls && git merge main   # pick up the other track's work
```

Checkpoints from the plan:
- **19:30**: a call creates a ticket.
- **23:00**: the full loop works (call, triage, contractor called, SMS).
- **02:00**: the photo and pattern moments work.
- **09:00**: code freeze. Deploy `main` to Vercel and point both Vapi agents at the production webhook URL.

## Starting a Claude session on your track

Clone the repo, `npm install`, copy `.env.example` to `.env.local` and fill it in, then check out your branch and tell Claude:

- Track A: *"Read CLAUDE.md and docs/TRACKS.md. I'm on Track A. Start with step 1."*
- Track B: *"Read CLAUDE.md and docs/TRACKS.md. I'm on Track B. Start with step 1."*
