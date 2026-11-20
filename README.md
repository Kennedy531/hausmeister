# Hausmeister

An AI voice caretaker. A tenant calls; before the call ends, the agent has triaged the problem, checked the building's history, booked a contractor by phone and texted the tenant a confirmed slot.

> "Tenants don't want a ticket number. They want the plumber booked."

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the keys (ask your teammate for the shared values)
npm run dev
```

Database: in the Supabase SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`, then your own `supabase/phones.local.sql` (copy it from `phones.example.sql` and add real numbers; it is git-ignored).

## Layout

| Path | What |
|---|---|
| `src/lib/contract.ts` | The 7 tools the voice agents call: names, inputs, outputs |
| `src/lib/tools/` | Tool implementations (database, pattern rule, SMS, dispatch) |
| `src/lib/vapi.ts` | Starts the outbound dispatcher call |
| `src/app/api/vapi/` | Webhook Vapi calls for every tool call |
| `agents/` | Voice agent prompts and tool definitions |
| `supabase/` | Schema and demo seed data |
| `docs/TRACKS.md` | How the work is split between two people |
