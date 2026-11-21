# Hausmeister: live demo script

About 3 minutes plus Q&A. The demo is the pitch: one real phone call, start to finish, with the dashboard on the big screen.

## Who does what

| Role | Who | Device |
|---|---|---|
| Presenter | Kennedy | Laptop with the dashboard on the projector |
| Tenant (calls in) | whoever holds the **…9862** phone | Calls **+31 85 083 5699**. Recognised as "Kennedy, flat 3B" |
| Plumber "Jan" | Emmanuel, holding the **…7117** phone | Gets the dispatcher's call |

Every contractor rings **…7117** right now, including the fallback plumber. If someone else plays the tenant or the plumber, update the numbers in Supabase first (`docs/STATUS.md` explains how).

## 10 minutes before

1. On the laptop, open `https://hausmeister-green.vercel.app/?key=<DASHBOARD_ADMIN_KEY>` (the key is in `.env.local`).
2. Press **Reset demo** (bottom left). It clears old calls and gives fresh slots today.
3. Switch to stage mode: press **S** (or add `&stage=1`). Go full screen. Check it says **"Waiting for a call"** and the timer reads **00:00.0**.
4. Both phones: charged, ringer on, **speaker on**, Do Not Disturb off. Test the hall's Wi-Fi or use a hotspot.
5. Have the backup video open in another tab or window, and Gmail (kennedyf531@gmail.com) open on a phone or second screen to show the confirmation email.
6. One quick test call if there's time, then **Reset demo** again.

## The script

| Time | Beat | What's said | What to point at |
|---|---|---|---|
| 0:00–0:20 | **Hook** | Presenter: "Raise your hand if you've messaged your landlord about something broken and waited days. Now imagine it's 11 pm and water is coming through your ceiling." | — |
| 0:20–0:35 | **Problem** | Presenter: "Today you get a ticket number. Someone has to triage it, check the building's history, find a contractor, and call everyone back. Let's call our caretaker instead." | — |
| 0:35 | **Call** | Tenant dials **+31 85 083 5699** on speaker. | Timer starts, "Live call" badge |
| | **1. It knows who's calling** | Agent: "Hi Kennedy, this is Hausmeister. Is this about apartment 3B in Building B?" Tenant: "Yes." | **Activity: Caller identified** |
| | **2. Triage** | Tenant: "Water is dripping from my ceiling." It asks up to two questions. Tenant: "Still dripping, and it's next to the ceiling light." | Conversation panel, live transcript |
| | **3. Ticket** | Agent creates the ticket (it should say not to touch the light). | Headline changes to the problem, urgency "Urgent" |
| | **4. Context moment** (the line Reltix will remember) | Agent: "This is the third leak report in your stack this month… I'm sending the plumber to 4B first." | **Pattern detected** banner, **building map lights up 4B "Visit first"** |
| | **5. When are you home?** | Agent: "When are you home today?" Tenant: "From twelve." | — |
| | **6. Contractor called** | Agent: "I'm calling Jan now…", then hangs up. **…7117 rings.** | Badge "Calling contractor", **Dispatch** card |
| | **7. The plumber** | Dispatcher opens in Dutch. Emmanuel either answers in Dutch (point at the **live English subtitles**) or says "English please" (it switches). It briefs him and offers the times that fit. Emmanuel: "The twelve o'clock works." | Contractor tab in the transcript |
| ~2:10 | **8. Booked** | Dispatcher confirms and hangs up. Seconds later the **confirmation email** arrives in kennedyf531@gmail.com: plumber, time, flat, ticket number, "check 4B first" and a safety tip. | **Timer stops**, "Booked", **Tenant notified: Confirmation emailed**, the **"What this call did"** card. Optional: show the email on a phone or a second screen |
| 2:10–2:40 | **Why it works** | Presenter: "Reltix says AI isn't the differentiator, context is. Hausmeister is what that context sounds like on the phone." | Pattern banner / building map again |
| 2:40–3:00 | **Close** | Presenter: "[Time on the timer] from call to plumber booked. Any hour, any language. Tenants don't want a ticket number. They want the plumber booked." | Impact card |

**Notifications:** the tenant's confirmation goes out **by email** (Gmail, live). The neighbour text is still SMS-only and isn't sent in the demo. If asked: "In production the neighbour gets an SMS; the message is ready on the ticket."

## What not to do

- **Don't hang up on the dispatcher without picking a time.** The app then calls the next plumber, which is the same phone again. If it happens: press **Reset demo** (needs the normal admin view, so press **S** first).
- **Don't talk over the agent.** Short answers, phone close, speaker on.
- **Don't pause long** before answering; the agent may fill the silence.

## If something goes wrong

| Problem | Do this |
|---|---|
| The agent creates the ticket but doesn't call the plumber | Press **S** to leave stage mode, then **Dispatch manually** (top right) |
| The plumber's phone doesn't ring | Say "the contractor's line is busy"; it automatically tries the next plumber. Otherwise switch to the backup video |
| The call drops or Wi-Fi fails | Phone hotspot for the laptop; switch to the backup video within 5 seconds |
| The agent mishears | Repeat once, slowly. Don't argue with it |
| The dashboard looks stuck | Refresh the page (keep the `?key=`); the data is safe in the database |

## Q&A cheat sheet

- **What does a call cost?** Measured: about **$0.07** per tenant call and **$0.05–0.09** per dispatcher call. The impact card shows the real number for this call.
- **What if it misdiagnoses?** It escalates when unsure; the contractor confirms on site; every step is logged on the ticket.
- **Emergencies?** Gas, fire or sparks get a fixed safety script ("leave, call 112"), an escalated ticket and an alert to the on-call manager, never a normal booking.
- **Languages?** English, Dutch and German; it follows whatever the person speaks, with live English subtitles on the dashboard.
- **How does it fit centrix?** The agent only talks to a few tools (look up tenant, building history, create ticket, dispatch). Each one maps to an API on their platform.
- **Contractor doesn't pick up?** It calls the next one by rating and availability, then escalates to a human.
- **What's next?** SMS and WhatsApp, photos of the damage, predictive maintenance from the pattern data, owner reports.
