BEGIN;

-- Remove boosting column
ALTER TABLE userlist
DROP COLUMN IF EXISTS boosting;

-- Remove log channel column
ALTER TABLE servers
DROP COLUMN IF EXISTS logchannel;

COMMIT;
