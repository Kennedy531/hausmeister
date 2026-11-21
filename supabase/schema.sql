-- Hausmeister database schema.
-- Run this first in the Supabase SQL editor, then seed.sql, then phones.local.sql.
-- Safe to re-run: it drops and recreates everything (phones.local.sql must then be run again).

drop table if exists call_events cascade;
drop table if exists ticket_events cascade;
drop table if exists tickets cascade;
drop table if exists contractor_slots cascade;
drop table if exists contractors cascade;
drop table if exists tenants cascade;
drop table if exists units cascade;
drop table if exists buildings cascade;
drop table if exists lease_rules cascade;

create table buildings (
  id bigint generated always as identity primary key,
  name text not null,                 -- "Building B"
  address text not null,
  city text not null,
  floors int not null,
  build_year int,
  boiler_type text,
  last_boiler_service date
);

create table units (
  id bigint generated always as identity primary key,
  building_id bigint not null references buildings(id) on delete cascade,
  label text not null,                -- "3B"
  floor int not null,
  stack text not null,                -- units in one stack sit vertically above each other
  unique (building_id, label)
);

create table tenants (
  id bigint generated always as identity primary key,
  unit_id bigint not null references units(id) on delete cascade,
  name text not null,
  phone text not null unique,         -- E.164, e.g. +31612345678
  language text not null default 'en' check (language in ('en', 'de', 'nl'))
);

create table contractors (
  id bigint generated always as identity primary key,
  name text not null,
  company text,
  trade text not null check (trade in ('plumber', 'electrician', 'locksmith', 'handyman')),
  phone text not null,
  rating numeric(2,1) not null,
  hourly_rate_eur int not null,
  language text not null default 'en' check (language in ('en', 'de', 'nl'))
);

create table contractor_slots (
  id bigint generated always as identity primary key,
  contractor_id bigint not null references contractors(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  booked boolean not null default false
);

-- Ticket ids start at 1001 so they sound like real ticket numbers on a call.
create table tickets (
  id bigint generated always as identity (start with 1001) primary key,
  unit_id bigint not null references units(id),
  tenant_id bigint references tenants(id),
  issue_type text not null check (issue_type in ('leak', 'heating', 'electrical', 'lock', 'appliance', 'pest', 'other')),
  urgency text not null default 'normal' check (urgency in ('emergency', 'urgent', 'normal')),
  status text not null default 'open' check (status in ('open', 'dispatching', 'scheduled', 'escalated', 'resolved')),
  summary text not null,
  photo_path text,                    -- object path in the private "photos" storage bucket
  photo_assessment text,
  photo_safety_advice text,
  pattern_flag boolean not null default false,
  pattern_note text,
  visit_unit_id bigint references units(id),
  contractor_id bigint references contractors(id),
  slot_id bigint references contractor_slots(id),
  scheduled_at timestamptz,
  tenant_call_id text,                -- Vapi call id of the tenant's call (one ticket per call)
  dispatcher_call_id text,            -- Vapi call id of the latest outbound contractor call
  dispatch_attempts int not null default 0,
  tried_contractor_ids bigint[] not null default '{}',
  escalation_reason text,
  call_started_at timestamptz,        -- when the tenant's call began (for the on-screen timer)
  booked_at timestamptz,              -- when the contractor accepted a slot
  created_at timestamptz not null default now(),
  -- Seed history survives reset_demo(); seed_age re-anchors it to "now" on every reset.
  seed boolean not null default false,
  seed_age interval
);

create index tickets_unit_issue_created on tickets (unit_id, issue_type, created_at desc);
create unique index tickets_one_per_call on tickets (tenant_call_id) where tenant_call_id is not null;
create index tickets_dispatcher_call on tickets (dispatcher_call_id);

-- A timeline of what happened on each ticket, shown live on the dashboard.
create table ticket_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  kind text not null,                 -- created, pattern, photo_link, photo, dispatch, booked, sms, escalated
  message text not null,
  created_at timestamptz not null default now()
);

-- Live transcript of both calls (tenant and dispatcher), streamed to the dashboard.
create table call_events (
  id bigint generated always as identity primary key,
  call_id text not null,
  agent text not null check (agent in ('tenant', 'dispatcher')),
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  text text not null,
  lang text,                          -- detected language of the line
  translation text,                   -- English translation, when the line isn't English
  ticket_id bigint references tickets(id) on delete set null,
  created_at timestamptz not null default now()
);

create index call_events_call on call_events (call_id, created_at);

-- Mock rules for who pays for which repair. Shown on screen as mock data, not tenancy law.
create table lease_rules (
  id bigint generated always as identity primary key,
  issue_type text not null,
  responsible text not null check (responsible in ('landlord', 'tenant')),
  note text not null
);

-- ---------------------------------------------------------------------------
-- Pattern rule. Open tickets with the same issue type in the same stack within
-- 30 days, from OTHER units than the caller's (so repeated rehearsal calls from
-- 3B don't inflate the count). 2 or more = pattern. The contractor visits the
-- highest reporting unit first (the caller's unit counts as reporting).
-- ---------------------------------------------------------------------------
create or replace function building_context(p_unit text, p_issue text)
returns json
language sql
stable
as $$
  with caller as (
    select u.* from units u where upper(u.label) = upper(trim(p_unit)) limit 1
  ),
  similar_t as (
    select x.label as unit, x.floor, t.issue_type, t.summary,
           greatest(0, extract(day from now() - t.created_at))::int as days_ago,
           t.created_at
    from tickets t
    join units x on x.id = t.unit_id
    join caller c on c.building_id = x.building_id and c.stack = x.stack and x.id <> c.id
    where t.issue_type = p_issue
      and t.status <> 'resolved'
      and t.created_at > now() - interval '30 days'
  ),
  reporting as (
    select unit, floor from similar_t
    union all
    select label, floor from caller
  )
  select json_build_object(
    'found', exists (select 1 from caller),
    'caller_unit', (select label from caller),
    'caller_floor', (select floor from caller),
    'similar_recent', coalesce((
      select json_agg(json_build_object(
        'unit', unit, 'floor', floor, 'issue_type', issue_type,
        'summary', summary, 'days_ago', days_ago) order by created_at desc)
      from similar_t), '[]'::json),
    'pattern', (select count(*) from similar_t) >= 2,
    'visit_first', case
      when (select count(*) from similar_t) >= 2
        then (select unit from reporting order by floor desc, unit limit 1)
      else (select label from caller)
    end
  );
$$;

-- ---------------------------------------------------------------------------
-- Atomic slot booking for confirm_slot. Refuses (with a reason the agent can say)
-- unless the ticket is being dispatched and the slot is a free slot of the
-- contractor that was called.
-- ---------------------------------------------------------------------------
create or replace function book_slot(p_ticket bigint, p_slot bigint)
returns json
language plpgsql
as $$
declare
  t tickets%rowtype;
  s contractor_slots%rowtype;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'No ticket with that number.');
  end if;
  if t.status = 'scheduled' then
    return json_build_object('ok', false, 'reason', 'This job is already booked.', 'already_booked', true,
                             'scheduled_at', t.scheduled_at);
  end if;
  if t.status <> 'dispatching' then
    return json_build_object('ok', false, 'reason', 'This ticket is not waiting for a contractor.');
  end if;

  update contractor_slots
     set booked = true
   where id = p_slot and contractor_id = t.contractor_id and not booked
  returning * into s;
  if not found then
    return json_build_object('ok', false,
      'reason', 'That slot is not one of the free slots offered. Offer the listed slots again.');
  end if;

  update tickets
     set status = 'scheduled', slot_id = s.id, scheduled_at = s.starts_at, booked_at = now()
   where id = p_ticket;

  return json_build_object('ok', true, 'scheduled_at', s.starts_at, 'ends_at', s.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Demo reset: run before every rehearsal (dashboard button or POST /api/demo/reset).
-- Deletes every ticket created by calls, clears transcripts, re-anchors the seed
-- history to now and gives every contractor two fresh free slots today.
-- Tenants and contractors (with their real phones) are kept.
-- ---------------------------------------------------------------------------
create or replace function reset_demo()
returns json
language plpgsql
as $$
declare
  removed int;
begin
  delete from call_events where true;
  with d as (delete from tickets where not seed returning 1) select count(*) into removed from d;
  update tickets set created_at = now() - seed_age where seed and seed_age is not null;
  update ticket_events e set created_at = t.created_at from tickets t where e.ticket_id = t.id and e.kind = 'created';
  delete from ticket_events e using tickets t where e.ticket_id = t.id and e.kind <> 'created';
  update tickets set slot_id = null where slot_id is not null;
  delete from contractor_slots where true;
  insert into contractor_slots (contractor_id, starts_at, ends_at)
  select c.id,
         date_trunc('hour', now()) + make_interval(hours => h),
         date_trunc('hour', now()) + make_interval(hours => h + 2)
  from contractors c, (values (2), (5)) as s(h);
  return json_build_object('tickets_removed', removed);
end;
$$;

-- These functions are for the server (secret key) only.
revoke execute on function building_context(text, text) from public;
revoke execute on function book_slot(bigint, bigint) from public;
revoke execute on function reset_demo() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function building_context(text, text), book_slot(bigint, bigint), reset_demo() from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function building_context(text, text), book_slot(bigint, bigint), reset_demo() to service_role';
  end if;
end $$;

-- Security: the server uses the secret key and bypasses RLS.
-- The browser (dashboard) may only read tickets, their events and the transcript,
-- which hold no phone numbers. Everything else goes through server routes.
alter table buildings enable row level security;
alter table units enable row level security;
alter table tenants enable row level security;
alter table contractors enable row level security;
alter table contractor_slots enable row level security;
alter table tickets enable row level security;
alter table ticket_events enable row level security;
alter table call_events enable row level security;
alter table lease_rules enable row level security;

create policy "dashboard reads tickets" on tickets for select to anon using (true);
create policy "dashboard reads ticket events" on ticket_events for select to anon using (true);
create policy "dashboard reads call events" on call_events for select to anon using (true);

-- Explicit table access for the Data API, so this works whether or not the project
-- grants new tables automatically. RLS above still limits what the browser (anon) sees.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema public to service_role';
    execute 'grant select, insert, update, delete on all tables in schema public to service_role';
    execute 'grant usage, select on all sequences in schema public to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant usage on schema public to anon';
    execute 'grant select on tickets, ticket_events, call_events to anon';
  end if;
end $$;

-- Live dashboard updates.
alter publication supabase_realtime add table tickets, ticket_events, call_events;

-- Private bucket for damage photos (served to the dashboard through signed URLs).
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;
