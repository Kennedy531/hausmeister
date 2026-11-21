-- Adds Dutch as a language and live English translations for the transcript.
-- Safe on a database that already has data: run it once in the Supabase SQL editor.
-- (schema.sql already includes these changes for fresh setups.)

alter table tenants drop constraint if exists tenants_language_check;
alter table tenants add constraint tenants_language_check check (language in ('en', 'de', 'nl'));
alter table contractors drop constraint if exists contractors_language_check;
alter table contractors add constraint contractors_language_check check (language in ('en', 'de', 'nl'));

alter table call_events add column if not exists lang text;          -- detected language of the line
alter table call_events add column if not exists translation text;   -- English translation, when not English

-- The plumber whose phone rings on stage speaks Dutch.
update contractors set language = 'nl' where trade = 'plumber';
