import { prefix, pgPool } from './common';

const creationQueries = [
	`CREATE TABLE servers (
		serverid varchar(18),
		servername varchar(50) NOT NULL,
		CONSTRAINT pk_servers PRIMARY KEY (serverid)
	)`,

	`CREATE TABLE channels (
		channelid varchar(18),
		channelName varchar(50) NOT NULL,
		serverid varchar(18) NOT NULL,
		CONSTRAINT pk_channels PRIMARY KEY (channelid),
		CONSTRAINT fk_channels_servers FOREIGN KEY (serverid) REFERENCES servers
	)`,

	`CREATE TABLE channellines (
		channelid varchar(18),
		logdate date,
		lines int NOT NULL,
		CONSTRAINT pk_channellines PRIMARY KEY (channelid, logDate),
		CONSTRAINT fk_channellines_channels FOREIGN KEY (channelid) REFERENCES channels
	)`,

	`CREATE TABLE users (
		userid varchar(18),
		name varchar(32) NOT NULL,
		discriminator varchar(4) NOT NULL,
		CONSTRAINT pk_users PRIMARY KEY (userid)
	)`,

	`CREATE TABLE userlist (
		serverid varchar(18),
		userid varchar(18),
		CONSTRAINT pk_userlist PRIMARY KEY (serverid, userid),
		CONSTRAINT fk_userlist_servers FOREIGN KEY (serverid) REFERENCES servers,
		CONSTRAINT fk_userlist_users FOREIGN KEY (userid) REFERENCES users
	)`,

	`CREATE TABLE lines (
		userid varchar(18),
		serverid varchar(18),
		logdate date,
		lines int NOT NULL,
		CONSTRAINT pk_lines PRIMARY KEY (userid, serverid, logdate),
		CONSTRAINT fk_lines_users FOREIGN KEY (userid) REFERENCES users,
		CONSTRAINT fk_lines_servers FOREIGN KEY (serverid) REFERENCES servers
	)`,

	`CREATE TABLE teamraters (
		userid varchar(18),
		channelid varchar(18),
		format varchar(40),
		CONSTRAINT pk_teamraters PRIMARY KEY (userid, channelid, format),
		CONSTRAINT fk_teamraters_users FOREIGN KEY (userid) REFERENCES users,
		CONSTRAINT fk_teamraters_channels FOREIGN KEY (channelid) REFERENCES channels
	)`,
];

// TODO cascade

/**
 * Check if tables have been created, and create them if they haven't.
 */
(async () => {
	let worker = await pgPool.connect();
	try {
		await worker.query('SELECT * FROM teamraters LIMIT 1');
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
		console.log('Tables not found, creating them...');
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
