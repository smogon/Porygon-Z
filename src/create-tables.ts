import { prefix, ID, toID, pgPool } from './common';

const creationQueries = [
	`CREATE TABLE Servers (
		ServerID varchar(18),
		ServerName varchar(50) NOT NULL,
		CONSTRAINT pk_servers PRIMARY KEY (ServerID)
	)`,

	`CREATE TABLE Channels (
		ChannelID varchar(18),
		ChannelName varchar(50) NOT NULL,
		ServerID varchar(18) NOT NULL,
		CONSTRAINT pk_channels PRIMARY KEY (ChannelID),
		CONSTRAINT fk_channels_servers FOREIGN KEY (ServerID) REFERENCES Servers
	)`,

	`CREATE TABLE ChannelLines (
		ChannelID varchar(18),
		LogDate date,
		Lines int NOT NULL,
		CONSTRAINT pk_channellines PRIMARY KEY (ChannelID, LogDate),
		CONSTRAINT fk_channellines_channels FOREIGN KEY (ChannelID) REFERENCES Channels
	)`,

	`CREATE TABLE Users (
		UserID varchar(18),
		Name varchar(32) NOT NULL,
		Tag varchar(4) NOT NULL,
		CONSTRAINT pk_users PRIMARY KEY (UserID)
	)`,

	`CREATE TABLE Userlist (
		ServerID varchar(18),
		UserID varchar(18),
		CONSTRAINT pk_userlist PRIMARY KEY (ServerID, UserID),
		CONSTRAINT fk_userlist_servers FOREIGN KEY (ServerID) REFERENCES Servers,
		CONSTRAINT fk_userlist_users FOREIGN KEY (UserID) REFERENCES Users
	)`,

	`CREATE TABLE Lines (
		UserID varchar(18),
		LogDate date,
		Lines int NOT NULL,
		CONSTRAINT pk_lines PRIMARY KEY (UserID, LogDate),
		CONSTRAINT fk_lines_users FOREIGN KEY (UserID) REFERENCES Users
	)`,

	`CREATE TABLE Tiers (
		Tier varchar(40),
		CONSTRAINT pk_tiers PRIMARY KEY (Tier)
	)`,

	`CREATE TABLE TeamRaters (
		UserID varchar(18),
		Tier varchar(40),
		CONSTRAINT pk_teamraters PRIMARY KEY (UserID, Tier),
		CONSTRAINT fk_teamraters_users FOREIGN KEY (UserID) REFERENCES Users,
		CONSTRAINT fk_teamraters_tiers FOREIGN KEY (Tier) REFERENCES Tiers
	)`
];

/**
 * Check if tables have been created, and create them if they haven't.
 */
(async () => {
	console.log('Checking for tables...');
	let worker = await pgPool.connect();
	try {
		await worker.query('SELECT * FROM Users LIMIT 1');
	} catch (e) {
		if (e.code !== '42P01') {
			console.log('Unexpected error when checking if tables are setup: ');
			console.log(e);
			worker.release();
			await pgPool.end();
			console.log('Exiting');
			process.exit(1);
		}
		// Setup database
		await worker.query('BEGIN');
		for (let query of creationQueries) {
			try {
				await worker.query(query);
			} catch (e) {
				console.log('Unexpected error when setting up tables: ');
				console.log(e);
				console.log('Rolling back and exiting');
				await worker.query('ROLLBACK');
				worker.release();
				await pgPool.end();
				process.exit(1);
			}
		}
		await worker.query('COMMIT');
	}
	worker.release();
})();
