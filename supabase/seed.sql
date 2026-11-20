-- Demo data, staged for the six demo moments. Run after schema.sql.
-- Phone numbers here are placeholders; phones.local.sql swaps in the team's real ones.
-- Slots are relative to now(), so re-run this on Saturday morning to get fresh "today" slots.

insert into buildings (name, address, city, floors, build_year, boiler_type, last_boiler_service)
values ('Building B', 'Kaiserswerther Str. 120', 'Düsseldorf', 5, 1962, 'Vaillant ecoTEC plus gas condensing boiler', '2025-10-14');

-- Stack B: 2B, 3B, 4B sit directly above each other. Stack A is unrelated.
insert into units (building_id, label, floor, stack) values
  (1, '1A', 1, 'A'),
  (1, '2A', 2, 'A'),
  (1, '3A', 3, 'A'),
  (1, '2B', 2, 'B'),
  (1, '3B', 3, 'B'),
  (1, '4B', 4, 'B');

insert into tenants (unit_id, name, phone, language) values
  ((select id from units where label = '3B'), 'Tadiwa',        '+490000000003', 'en'), -- demo caller
  ((select id from units where label = '4B'), 'Lena Hoffmann', '+490000000004', 'de'), -- spare number
  ((select id from units where label = '2B'), 'Murat Yilmaz',  '+490000000002', 'de'),
  ((select id from units where label = '1A'), 'Sofia Rossi',   '+490000000011', 'en'),
  ((select id from units where label = '2A'), 'Peter Krämer',  '+490000000012', 'de'),
  ((select id from units where label = '3A'), 'Aisha Bello',   '+490000000013', 'en');

insert into contractors (name, company, trade, phone, rating, hourly_rate_eur, language) values
  ('Jan',    'Jan Schulte Sanitär',    'plumber',     '+490000000100', 4.8, 65, 'en'), -- Emmanuel's phone
  ('Ingrid', 'Elektro Brandt',         'electrician', '+490000000101', 4.6, 70, 'en'),
  ('Kai',    'Schlüsseldienst Rhein',  'locksmith',   '+490000000102', 4.4, 55, 'en'),
  ('Olu',    'Hausservice Okafor',     'handyman',    '+490000000103', 4.7, 45, 'en');

-- Two free slots today for every contractor.
insert into contractor_slots (contractor_id, starts_at, ends_at)
select c.id,
       date_trunc('hour', now()) + make_interval(hours => h),
       date_trunc('hour', now()) + make_interval(hours => h + 2)
from contractors c, (values (2), (5)) as s(h);

-- History. The two open leaks in stack B are what make the context moment work.
insert into tickets (unit_id, tenant_id, issue_type, urgency, status, summary, created_at) values
  ((select id from units where label = '4B'), (select id from tenants where name = 'Lena Hoffmann'),
   'leak', 'urgent', 'open', 'Bathroom leak under the bathtub, water pooling on the floor', now() - interval '6 days'),
  ((select id from units where label = '2B'), (select id from tenants where name = 'Murat Yilmaz'),
   'leak', 'normal', 'open', 'Brown water stain spreading on the kitchen ceiling', now() - interval '3 days'),
  -- Unrelated older tickets, so the history doesn't look staged.
  ((select id from units where label = '1A'), (select id from tenants where name = 'Sofia Rossi'),
   'lock', 'urgent', 'resolved', 'Front door lock jammed, key will not turn', now() - interval '41 days'),
  ((select id from units where label = '2A'), (select id from tenants where name = 'Peter Krämer'),
   'heating', 'normal', 'resolved', 'Radiator in the bedroom stays cold', now() - interval '58 days'),
  ((select id from units where label = '3A'), (select id from tenants where name = 'Aisha Bello'),
   'appliance', 'normal', 'resolved', 'Extractor fan in the bathroom makes a grinding noise', now() - interval '22 days'),
  ((select id from units where label = '3B'), (select id from tenants where name = 'Tadiwa'),
   'electrical', 'normal', 'resolved', 'Hallway light flickers', now() - interval '75 days');

insert into ticket_events (ticket_id, kind, message, created_at)
select id, 'created', 'Ticket created: ' || summary, created_at from tickets;

insert into lease_rules (issue_type, responsible, note) values
  ('leak',       'landlord', 'Pipes, risers and the building fabric are the landlord''s responsibility.'),
  ('heating',    'landlord', 'Central heating and radiators are maintained by the landlord.'),
  ('electrical', 'landlord', 'Fixed wiring and sockets; bulbs are the tenant''s.'),
  ('lock',       'tenant',   'Lost keys and lockouts are paid by the tenant; a broken lock is the landlord''s.'),
  ('appliance',  'landlord', 'Appliances supplied with the flat; small repairs under €100 fall to the tenant.'),
  ('pest',       'landlord', 'Unless caused by the tenant.');
