# Demo video (competition deliverable)

Target length: about 2:30. Check the organisers' limit first and cut the voiceover to fit.
Cards: the PNGs in this folder (1920×1080). Edit text in `cards.html`, re-render with
`node demo-video/render.cjs demo-video` (needs Playwright).

| Time | Picture | Voiceover |
|---|---|---|
| 0:00–0:06 | `01-title.png` | "This is Hausmeister, the AI caretaker that books the plumber before you hang up." |
| 0:06–0:20 | `02-problem.png` | "It's 11 pm and water is coming through your ceiling. Today you get a ticket number, and someone has to triage it, check the building, find a contractor and call everyone back. That takes days." |
| 0:20–0:24 | `03-live.png` | "Here's one real call. Real phones, real time, no cuts." |
| 0:24–1:50 | **Uncut live run**: dashboard in stage mode (`/?stage=1`), phone mirrored or filmed on the side, call audio on | Mostly silent: let the call speak. Short captions only at the key beats (see below). |
| 1:50–2:05 | `04-context.png` | "The difference is context. Hausmeister read the building's history, saw three leaks in the same stack, sent the plumber to the flat above first, and asked that neighbour for access." |
| 2:05–2:20 | `05-connector.png` | "And the plumber is just partner one. Every partner (internet, energy) plugs in the same way: one new file." |
| 2:20–2:30 | `06-close.png` | "Tenants don't want a ticket number. They want the plumber booked." |

## Captions during the live run (one line each, bottom of screen)
1. Caller recognised by phone number
2. Two triage questions
4. **Building history: third leak in this stack, plumber goes to 4B first**
5. "When are you home today?": only matching slots are offered
6. AI dispatcher phones the plumber (in Dutch, live English subtitles)
7. Booked, tenant and neighbour texted. Timer stops.

## Recording the live run
- Reset the demo, open the dashboard with `?stage=1`, full screen, 1080p.
- Quiet room, both phones on speaker next to the laptop mic. Test 10 seconds and listen back.
- Same script as on stage. 2–3 takes, keep the best, keep it uncut (the timer proves it's real).
- Export MP4 (H.264, 1080p). Keep copies on two laptops and a USB stick.
