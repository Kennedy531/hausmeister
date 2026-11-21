-- Demo data, staged for the six demo moments. Run after schema.sql.
-- Phone numbers here are placeholders; phones.local.sql swaps in the team's real ones.
-- History and slots are relative to now(). Before every rehearsal run `select reset_demo();`
-- (or press Reset on the dashboard) to clear test tickets and get fresh "today" slots.

insert into buildings (name, address, city, floors, build_year, boiler_type, last_boiler_service)
values ('Building B', 'Beispielweg 7 (mock address)', 'Düsseldorf', 4, 1962, 'Vaillant ecoTEC plus gas condensing boiler', '2025-10-14');

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
  ('Jan',    'Jan Schulte Sanitär',    'plumber',     '+490000000100', 4.8, 65, 'nl'), -- speaks Dutch: the dispatcher calls in Dutch -- Emmanuel's phone
  ('Ingrid', 'Elektro Brandt',         'electrician', '+490000000101', 4.6, 70, 'en'),
  ('Kai',    'Schlüsseldienst Rhein',  'locksmith',   '+490000000102', 4.4, 55, 'en'),
  ('Olu',    'Hausservice Okafor',     'handyman',    '+490000000103', 4.7, 45, 'en'),
  -- Second plumber: called if Jan doesn't pick up (use the spare phone for this).
  ('Mila',   'Rhein Rohrservice',      'plumber',     '+490000000104', 4.5, 60, 'en');


-- History. The two open leaks in stack B are what make the context moment work.
insert into tickets (unit_id, tenant_id, issue_type, urgency, status, summary, seed, seed_age) values
  ((select id from units where label = '4B'), (select id from tenants where name = 'Lena Hoffmann'),
   'leak', 'urgent', 'open', 'Bathroom leak under the bathtub, water pooling on the floor', true, interval '6 days'),
  ((select id from units where label = '2B'), (select id from tenants where name = 'Murat Yilmaz'),
   'leak', 'normal', 'open', 'Brown water stain spreading on the kitchen ceiling', true, interval '3 days'),
  -- Unrelated older tickets, so the history doesn't look staged.
  ((select id from units where label = '1A'), (select id from tenants where name = 'Sofia Rossi'),
   'lock', 'urgent', 'resolved', 'Front door lock jammed, key will not turn', true, interval '41 days'),
  ((select id from units where label = '2A'), (select id from tenants where name = 'Peter Krämer'),
   'heating', 'normal', 'resolved', 'Radiator in the bedroom stays cold', true, interval '58 days'),
  ((select id from units where label = '3A'), (select id from tenants where name = 'Aisha Bello'),
   'appliance', 'normal', 'resolved', 'Extractor fan in the bathroom makes a grinding noise', true, interval '22 days'),
  ((select id from units where label = '3B'), (select id from tenants where name = 'Tadiwa'),
   'electrical', 'normal', 'resolved', 'Hallway light flickers', true, interval '75 days');

insert into ticket_events (ticket_id, kind, message, created_at)
select id, 'created', 'Ticket created: ' || summary, now() from tickets;

insert into lease_rules (issue_type, responsible, note) values
  ('leak',       'landlord', 'Pipes, risers and the building fabric are the landlord''s responsibility.'),
  ('heating',    'landlord', 'Central heating and radiators are maintained by the landlord.'),
  ('electrical', 'landlord', 'Fixed wiring and sockets; bulbs are the tenant''s.'),
  ('lock',       'tenant',   'Lost keys and lockouts are paid by the tenant; a broken lock is the landlord''s.'),
  ('appliance',  'landlord', 'Appliances supplied with the flat; small repairs under €100 fall to the tenant.'),
  ('pest',       'landlord', 'Unless caused by the tenant.');

-- Sets the seed history's dates and creates two free slots today for every contractor.
select reset_demo();
