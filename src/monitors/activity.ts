/**
 * activity.ts
 * Keeps track of line counts for users and channels.
 * Also see src/commands/activity.ts
 */
import Discord = require('discord.js');
import {pgPool} from '../common';
import {BaseMonitor} from '../command_base';
// Number of days to keep lines for before pruning
const LINE_PRUNE_CUTOFF = 60;

/**
 * Prunes the lines and channellines tables in the database so that only 60 days of logs are kept
 */
async function prune() {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - LINE_PRUNE_CUTOFF);
	cutoff.setHours(0, 0, 0, 0);
	const worker = await pgPool.connect();

	try {
		await worker.query('BEGIN');

		await worker.query('DELETE FROM lines WHERE logdate < $1', [cutoff]);
		await worker.query('DELETE FROM channellines WHERE logdate < $1', [cutoff]);

		await worker.query('COMMIT');
		worker.release();

		const nextPrune = new Date();
		nextPrune.setDate(nextPrune.getDate() + 1);
		nextPrune.setHours(0, 0, 0, 0);
		setTimeout(() => {
			void prune();
		}, nextPrune.getTime() - Date.now());
	} catch (e) {
		await worker.query('ROLLBACK');
		worker.release();

		const nextPrune = new Date();
		nextPrune.setDate(nextPrune.getDate() + 1);
		nextPrune.setHours(0, 0, 0, 0);
		setTimeout(() => {
			void prune();
		}, nextPrune.getTime() - Date.now());

		throw e;
	}
}

// Prune any old logs on startup, also starts the timer for pruning
void prune();

export class ActivityMonitor extends BaseMonitor {
	constructor(message: Discord.Message) {
		super(message, 'Activity Monitor');
	}

	async shouldExecute() {
		if (!this.guild) {
			// Should never happen, monitors do not run in PMs
			throw new Error('Activity monitor attempted to run outide of a guild.');
		}
		// Insert channel line info - only for publicly accessible channels
		await this.guild.roles.fetch();
		const everyone = this.guild.roles.everyone; // everyone is always a role
		if (!everyone) throw new Error('Unable to find the everyone role when logging linecounts.');
		const permissions = this.channel.permissionOverwrites.get(everyone.id);
		if (permissions?.deny.has('VIEW_CHANNEL')) {
			// There are custom permissions for @everyone on this channel, and @everyone cannot view the channel.
			return false;
		}
		return true;
	}

	async execute() {
		if (!this.guild) {
			// Should never happen, monitors do not run in PMs
			throw new Error('Activity monitor attempted to run outide of a guild.');
		}
		this.worker = await pgPool.connect();
		const date = new Date(); // Log date

		await this.verifyData({
			author: this.author,
			guild: this.guild,
			channel: this.channel,
		});

		// Insert user line info
		let res = await this.worker.query(
			'SELECT * FROM lines WHERE userid = $1 AND logdate = $2 AND serverid = $3',
			[this.author.id, date, this.guild.id]
		);
		if (!res.rows.length) {
			// Insert new row
			await this.worker.query(
				'INSERT INTO lines (userid, logdate, serverid, lines) VALUES ($1, $2, $3, 1)',
				[this.author.id, date, this.guild.id]
			);
		} else {
			// update row
			await this.worker.query(
				'UPDATE lines SET lines = lines + 1 WHERE userid = $1 AND logdate = $2 AND serverid = $3',
				[this.author.id, date, this.guild.id]
			);
		}

		res = await this.worker.query(
			'SELECT * FROM channellines WHERE channelid = $1 AND logdate = $2',
			[this.channel.id, date]
		);
		if (!res.rows.length) {
			// Insert new row
			await this.worker.query(
				'INSERT INTO channellines (channelid, logdate, lines) VALUES ($1, $2, 1)',
				[this.channel.id, date]
			);
		} else {
			// Update row
			await this.worker.query(
				'UPDATE channellines SET lines = lines + 1 WHERE channelid = $1 AND logdate = $2',
				[this.channel.id, date]
			);
		}

		this.worker.release();
		this.worker = null;
	}
}
