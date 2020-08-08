BEGIN;

-- Create a column for storing what roles are persistant on the servers table
ALTER TABLE servers
DROP COLUMN sticky;

-- Remove column for storing persistant roles on the userlist table
ALTER TABLE userlist
DROP COLUMN sticky;

COMMIT;
