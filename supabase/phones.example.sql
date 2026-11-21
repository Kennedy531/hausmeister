-- Copy this file to phones.local.sql (git-ignored), put in the team's real numbers
-- in E.164 format (e.g. +316..., exactly as the phone shows as caller ID), and run it in the Supabase SQL editor after seed.sql.

update tenants     set phone = '+31TADIWA_NUMBER'   where name = 'Tadiwa';        -- tenant calling in (3B)
update tenants     set phone = '+31SPARE_NUMBER'    where name = 'Lena Hoffmann'; -- spare phone (4B)
update contractors set phone = '+31EMMANUEL_NUMBER' where name = 'Jan';           -- plumber whose phone rings on stage
