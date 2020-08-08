BEGIN;

-- Create a column for storing what roles are persistant on the servers table
ALTER TABLE servers
ADD COLUMN sticky varchar(18)[];

UPDATE servers
SET sticky = '{}';

ALTER TABLE servers
ALTER COLUMN sticky
SET NOT NULL;


-- Create a column for storing persistant roles for a given user on the userlist table
ALTER TABLE userlist
ADD COLUMN sticky varchar(18)[];

UPDATE userlist
SET sticky = '{}';

ALTER TABLE userlist
ALTER COLUMN sticky
SET NOT NULL;

COMMIT;
