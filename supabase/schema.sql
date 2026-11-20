-- Hausmeister database schema.
-- Run this first in the Supabase SQL editor, then seed.sql, then phones.local.sql.
-- Safe to re-run: it drops and recreates everything.

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
  phone text not null unique,         -- E.164, e.g. +4915112345678
  language text not null default 'en' check (language in ('en', 'de'))
);

create table contractors (
  id bigint generated always as identity primary key,
  name text not null,
  company text,
  trade text not null check (trade in ('plumber', 'electrician', 'locksmith', 'handyman')),
  phone text not null,
  rating numeric(2,1) not null,
  hourly_rate_eur int not null,
  language text not null default 'en' check (language in ('en', 'de'))
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
  photo_url text,
  photo_assessment text,
  pattern_flag boolean not null default false,
  pattern_note text,
  visit_unit_id bigint references units(id),
  contractor_id bigint references contractors(id),
  slot_id bigint references contractor_slots(id),
  scheduled_at timestamptz,
  call_started_at timestamptz,        -- when the tenant's call began (for the on-screen timer)
  booked_at timestamptz,              -- when the contractor accepted a slot
  created_at timestamptz not null default now()
);

create index tickets_unit_issue_created on tickets (unit_id, issue_type, created_at desc);

-- A timeline of what happened on each ticket, shown live on the dashboard.
create table ticket_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  kind text not null,                 -- created, pattern, photo_link, photo, dispatch, booked, sms, escalated
  message text not null,
  created_at timestamptz not null default now()
);

-- Mock rules for who pays for which repair. Shown on screen as mock data, not tenancy law.
create table lease_rules (
  id bigint generated always as identity primary key,
  issue_type text not null,
  responsible text not null check (responsible in ('landlord', 'tenant')),
  note text not null
);

-- Security: the server uses the secret key and bypasses RLS.
-- The browser (dashboard) may only read tickets and their events, which hold no phone numbers.
alter table buildings enable row level security;
alter table units enable row level security;
alter table tenants enable row level security;
alter table contractors enable row level security;
alter table contractor_slots enable row level security;
alter table tickets enable row level security;
alter table ticket_events enable row level security;
alter table lease_rules enable row level security;

create policy "dashboard reads tickets" on tickets for select to anon using (true);
create policy "dashboard reads ticket events" on ticket_events for select to anon using (true);

-- Live dashboard updates.
alter publication supabase_realtime add table tickets, ticket_events;
