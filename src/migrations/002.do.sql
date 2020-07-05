BEGIN;

-- Create new column for storting boost status
ALTER TABLE IF EXISTS userlist
ADD COLUMN IF NOT EXISTS boosting date;

-- Create new column for storing log channel
ALTER TABLE IF EXISTS servers
ADD COLUMN IF NOT EXISTS logchannel varchar(18);

-- List log channel as a foreign key
ALTER TABLE IF EXISTS servers
ADD CONSTRAINT fk_servers_channels FOREIGN KEY (logchannel) REFERENCES channels (channelid);

COMMIT;
