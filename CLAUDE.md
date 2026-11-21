@AGENTS.md

# Hausmeister

An AI voice caretaker for the Reltix hackathon track. A tenant calls, the agent triages the problem, spots repeat issues in the building, books a contractor by phone and texts the tenant the slot.

Stack: Next.js 16 (App Router, `src/`), Supabase, Vapi (with an ElevenLabs voice and an OpenAI model), Twilio SMS (off for the demo), OpenAI (live subtitles).

## Two people build this in parallel

Read `docs/TRACKS.md` before doing anything. The work is split into Track A (calls) and Track B (data & screens), each on its own branch.

- Ask which track the user is on if they haven't said, and work only on that track's branch (`track-a-calls` or `track-b-data`).
- Edit only files your track owns (listed in `docs/TRACKS.md`). If a task needs a change in the other track's files, stop and tell the user what to ask their teammate for.
- `src/lib/contract.ts`, `src/lib/tools/types.ts` and `DispatcherBrief` in `src/lib/vapi.ts` are shared. Don't change them unless the user confirms the teammate agreed.
- Track A adds no npm packages. Use `fetch` for HTTP APIs.

## Working rules

- After each finished change, run `npx tsc --noEmit` and `npm run lint`, then commit with one plain sentence saying what the change does. Push to your track branch when the user asks.
- Never commit `.env.local`, keys, or real phone numbers. Real numbers live only in `supabase/phones.local.sql` (git-ignored).
- Keep the demo path working. A full loop that works beats more half-built features. If a checkpoint slips, cut the next "Should" feature, never the rehearsal.
