-- "When are you home today?": the tenant's window is stored on the ticket, and every
-- contractor gets three free slots a day (1, 3 and 6 hours from now) so the filtering shows.
-- Safe on a database that already has data: run it once in the Supabase SQL editor.
-- (schema.sql already includes these changes for fresh setups.)

alter table tickets add column if not exists available_from timestamptz;   -- tenant is home from
alter table tickets add column if not exists available_until timestamptz;  -- tenant is home until (null = rest of the day)

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
  from contractors c, (values (1), (3), (6)) as s(h);
  return json_build_object('tickets_removed', removed);
end;
$$;

revoke execute on function reset_demo() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function reset_demo() from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function reset_demo() to service_role';
  end if;
end $$;

-- Fresh slots in the new pattern right away.
select reset_demo();
