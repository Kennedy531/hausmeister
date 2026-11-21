# Partner connectors

Hausmeister turns something that happens to a tenant into a confirmed result with an outside partner, without a property manager in the loop. The contractor is partner one and runs live in the demo. Internet and energy are the next two partners; they are specified here but not built.

| Partner | Outcome for the tenant | Status |
|---|---|---|
| Contractor | Repair booked before the call ends | **Live** |
| Internet provider | Line working on move-in day | Spec |
| Energy supplier | Cheaper contract, switched with the tenant's consent | Spec |

## The five steps every partner follows

| Step | What happens | Contractor (live) |
|---|---|---|
| 1. Trigger | Something happens for a tenant | The tenant phones the caretaker line; the agent triages and calls `create_ticket` |
| 2. Context | Load the tenant, unit, building and history | `lookup_tenant` (caller ID), building history and pattern rule in `src/lib/tools/data.ts` |
| 3. Contact | Pick the right partner and reach them | `dispatchTicket` picks the best-rated contractor of the right trade with a free slot while the tenant is home, then an AI dispatcher phones them (`src/lib/vapi.ts`, `agents/dispatcher/prompt.md`) |
| 4. Confirm | The partner commits to a time or an order | The contractor picks a slot out loud; `confirm_slot` books it atomically (`book_slot` in `supabase/schema.sql`) |
| 5. Inform | The tenant gets the result | Booking email with who, when and a safety tip (`src/lib/email.ts`); the dashboard updates live |

If step 3 or 4 fails (no answer, voicemail, the partner declines), the connector tries the next partner, and after `MAX_DISPATCH_ATTEMPTS` the ticket is escalated to a human (`onDispatcherCallEnded` in `src/lib/tools/dispatch.ts`).

## Connector interface

Proposed. Today the contractor connector lives in the files named above. Extracting it into this interface is the first task when adding partner two; after that, a new partner is one file in `src/lib/connectors/`, plus an agent prompt if it talks to the partner by phone.

```ts
// src/lib/connectors/types.ts (proposed)
import type { Language } from "@/lib/contract";

/** What every connector gets from the property platform (centrix in production, Supabase mock data today). */
export interface TenantContext {
  tenant: { id: number; name: string; phone: string; email: string | null; language: Language };
  unit: { id: number; label: string; floor: number; stack: string };
  building: { id: number; name: string; address: string; city: string };
}

export type Trigger =
  | { kind: "tenant_call"; ticketId: number }                 // contractor
  | { kind: "move_in"; leaseId: number; moveInDate: string }  // internet, energy
  | { kind: "contract_ending"; unitId: number; endsOn: string }; // energy

export interface Partner {
  id: number;
  name: string;
  channel: "voice" | "api";
  phone?: string;   // voice partners
  rating?: number;
}

export interface Offer {
  id: string;
  label: string;     // what the agent says or the email shows, e.g. "today 16:00 to 18:00"
  startsAt?: string; // ISO
  priceEur?: number;
}

export type Confirmation =
  | { ok: true; reference: string; summary: string } // booking id, order number, contract number
  | { ok: false; reason: string };

export interface PartnerConnector<Job> {
  id: "contractor" | "internet" | "energy";
  /** Which triggers start this connector. */
  handles: Trigger["kind"][];
  /** Turn the trigger plus context into a job, or refuse with a reason. */
  buildJob(trigger: Trigger, ctx: TenantContext): Promise<Job | { refused: string }>;
  /** Partners for this job, best first. */
  rankPartners(job: Job): Promise<Partner[]>;
  /** Reach the partner (phone call or API request) and get offers back. */
  contact(partner: Partner, job: Job): Promise<{ offers: Offer[] }>;
  /** Commit to one offer. Must be idempotent: a second call returns the same confirmation. */
  confirm(job: Job, offer: Offer): Promise<Confirmation>;
  /** Tell the tenant. Never throws; returns whether it was delivered. */
  inform(ctx: TenantContext, job: Job, confirmation: Confirmation): Promise<{ sent: boolean }>;
  /** Does the tenant have to say yes before confirm()? True for anything the tenant pays for. */
  needsTenantConsent: boolean;
}
```

Every step writes a row to `ticket_events` (`dispatch`, `booked`, `email`, `escalated`, ...). The dashboard's activity list and timer read those rows, so a new partner shows up on the dashboard without dashboard code changes.

## Context: what comes from the platform

Each tool maps to data Reltix already holds in centrix. In the demo the same data is mock rows in Supabase.

| Hausmeister uses | Demo source (Supabase) | Production source (centrix) |
|---|---|---|
| Tenant by caller ID: name, flat, language | `tenants`, `units` | Tenant records |
| Building and its specs | `buildings` | Building specs |
| Repeat issues in the same stack | `tickets` (30-day pattern rule) | Maintenance history |
| Contractors: trade, rating, rate, language | `contractors` | Contractor history |
| Contractor free times | `contractor_slots` | Contractor calendars or the dispatcher call itself |
| Who pays for which repair | `lease_rules` (mock) | Lease terms |
| Ticket and its log | `tickets`, `ticket_events` | Tickets / tenant interactions |

## Partner 1: Contractor (live)

- **Trigger:** inbound tenant call. The tenant agent identifies the caller, asks at most two triage questions, creates the ticket and asks "When are you home today?".
- **Partner choice:** trade from the issue (`TRADE_FOR_ISSUE` in `src/lib/contract.ts`), then highest rating with a free slot inside the tenant's window. If nobody is free then, the agent offers the earliest time instead.
- **Contact:** outbound phone call by the dispatcher agent. It gets a brief (`DispatcherBrief`): contractor name, language, building, address, flat, urgency, problem summary, when the tenant is home, and only the slots that fit. The tenant's phone number is not shared with the contractor.
- **Language:** opens in the contractor's stored language and switches to whatever they speak; the dashboard shows live English subtitles.
- **Confirm:** `confirm_slot` with a slot id from the brief. Refuses slots outside the tenant's window; the database function books atomically, so a slot can't be booked twice.
- **Inform:** email to the tenant: contractor, company, time, flat, ticket number and a safety tip.
- **Guards:** no dispatch for emergencies (gas, fire, sparks get the 112 script and an escalated ticket); no dispatch unless the ticket is open; one ticket per call.
- **Measured cost:** about $0.07 per tenant call and $0.05 to $0.09 per dispatcher call.

## Partner 2: Internet provider (spec)

Goal: the tenant's internet works on the day they move in, without them phoning a provider.

- **Trigger:** a signed lease with a move-in date (`move_in`), 3 weeks ahead. Also a tenant call about no internet, which reuses the contractor flow's triage.
- **Context needed:** move-in date, flat, the connection id for the flat (new field on `units`, e.g. fibre access point id), which providers serve the building.
- **Partners:** providers available at the address, ranked by price for the building's standard plan and by past activation reliability.
- **Contact:** provider order API where one exists; otherwise the dispatcher agent calls the provider's business line with an order brief (address, connection id, wanted activation date).
- **Offers:** activation dates and, if a technician is needed, appointment windows.
- **Consent:** yes. The tenant pays for the contract, so the tenant confirms provider and plan first (email link or a short call) before the order is placed.
- **Confirm:** order number and activation date.
- **Inform:** email with provider, plan, activation date and when the router arrives.
- **Failure:** no activation before move-in → order the earliest date and tell the tenant; provider refuses → next provider; after two failures → property manager.

## Partner 3: Energy supplier (spec)

Goal: every tenant is on a fair energy contract, switched with their consent.

- **Trigger:** move-in, and 6 weeks before a tenant's current contract ends (`contract_ending`).
- **Context needed:** meter ids for the flat (electricity and gas, new fields on `units`), the building's typical yearly use for a flat that size, current contract end date if the tenant shares it.
- **Partners:** suppliers or a switching service with an API, ranked by expected yearly cost for that flat.
- **Contact:** API quote request with meter ids and estimated use.
- **Offers:** two or three tariffs with yearly cost, contract length and green share.
- **Consent:** required. The agent never switches on its own. It presents the options (call or email) and switches only after an explicit yes from the tenant, which is logged on the ticket.
- **Confirm:** switch request accepted, with the supplier's contract number and start date.
- **Inform:** email with supplier, tariff, yearly cost and start date.
- **Failure:** quote or switch rejected → next supplier, then the property manager.

## Rules for every connector

1. **Guard first.** A connector refuses with a reason the agent can say (wrong state, emergency, nothing available) instead of throwing.
2. **Never in an emergency.** Safety script, escalation and a human, always.
3. **Consent for anything the tenant pays for.** Repairs the landlord pays for can be booked straight away; contracts in the tenant's name need an explicit yes.
4. **Share the minimum.** A partner gets what the job needs: address and problem for a contractor, meter ids for an energy supplier. Never the tenant's phone number unless the tenant agrees.
5. **Idempotent confirm.** Retries and double tool calls must not create two bookings or two orders.
6. **Retry, then a human.** Try the next partner; after the limit, escalate to the on-call manager with the reason.
7. **Log every step** in `ticket_events`, so the dashboard and the audit trail stay complete.

## Adding a partner

1. Write `src/lib/connectors/<partner>.ts` implementing `PartnerConnector`.
2. Register it for its triggers in `src/lib/connectors/index.ts`.
3. Voice partners only: add `agents/<partner>/prompt.md` and its confirm tool in `agents/config.mjs`, then run `node scripts/sync-agents.mjs`.
4. Add the partner table and demo rows to `supabase/schema.sql` and `supabase/seed.sql`.
5. Test the loop without phones with `node scripts/simulate-demo.mjs`, then with one real call.
