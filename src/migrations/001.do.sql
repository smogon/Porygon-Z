BEGIN;

CREATE TABLE IF NOT EXISTS servers (
	serverid varchar(18),
	servername varchar(50) NOT NULL,
	CONSTRAINT pk_servers PRIMARY KEY (serverid)
);

CREATE TABLE IF NOT EXISTS channels (
	channelid varchar(18),
	channelName varchar(50) NOT NULL,
	serverid varchar(18) NOT NULL,
	CONSTRAINT pk_channels PRIMARY KEY (channelid),
	CONSTRAINT fk_channels_servers FOREIGN KEY (serverid) REFERENCES servers
);

CREATE TABLE IF NOT EXISTS channellines (
	channelid varchar(18),
	logdate date,
	lines int NOT NULL,
	CONSTRAINT pk_channellines PRIMARY KEY (channelid, logDate),
	CONSTRAINT fk_channellines_channels FOREIGN KEY (channelid) REFERENCES channels
);

CREATE TABLE IF NOT EXISTS users (
	userid varchar(18),
	name varchar(32) NOT NULL,
	discriminator varchar(4) NOT NULL,
	CONSTRAINT pk_users PRIMARY KEY (userid)
);

CREATE TABLE IF NOT EXISTS userlist (
	serverid varchar(18),
	userid varchar(18),
	CONSTRAINT pk_userlist PRIMARY KEY (serverid, userid),
	CONSTRAINT fk_userlist_servers FOREIGN KEY (serverid) REFERENCES servers,
	CONSTRAINT fk_userlist_users FOREIGN KEY (userid) REFERENCES users
);

CREATE TABLE IF NOT EXISTS lines (
	userid varchar(18),
	serverid varchar(18),
	logdate date,
	lines int NOT NULL,
	CONSTRAINT pk_lines PRIMARY KEY (userid, serverid, logdate),
	CONSTRAINT fk_lines_users FOREIGN KEY (userid) REFERENCES users,
	CONSTRAINT fk_lines_servers FOREIGN KEY (serverid) REFERENCES servers
);

CREATE TABLE IF NOT EXISTS teamraters (
	userid varchar(18),
	channelid varchar(18),
	format varchar(40),
	CONSTRAINT pk_teamraters PRIMARY KEY (userid, channelid, format),
	CONSTRAINT fk_teamraters_users FOREIGN KEY (userid) REFERENCES users,
	CONSTRAINT fk_teamraters_channels FOREIGN KEY (channelid) REFERENCES channels
);

COMMIT;
