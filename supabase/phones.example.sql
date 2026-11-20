-- Copy this file to phones.local.sql (git-ignored), put in the team's real numbers
-- in E.164 format (+49...), and run it in the Supabase SQL editor after seed.sql.

update tenants     set phone = '+49TADIWA_NUMBER'   where name = 'Tadiwa';        -- tenant calling in (3B)
update tenants     set phone = '+49SPARE_NUMBER'    where name = 'Lena Hoffmann'; -- spare phone (4B)
update contractors set phone = '+49EMMANUEL_NUMBER' where name = 'Jan';           -- plumber whose phone rings on stage
