/**
 * activity.ts
 * Keeps track of line counts for users and channels.
 * Also see src/commands/activity.ts
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseMonitor, DiscordChannel } from '../command_base';
// Number of days to keep lines for before pruning
const LINE_PRUNE_CUTOFF = 60;

/**
 * Prunes the lines and channellines tables in the database so that only 60 days of logs are kept
 */
async function prune() {
	let cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - LINE_PRUNE_CUTOFF);
	cutoff.setHours(0, 0, 0, 0);
	let worker = await pgPool.connect();

	try {
		await worker.query('BEGIN');

		await worker.query('DELETE FROM lines WHERE logdate < $1', [cutoff]);
		await worker.query('DELETE FROM channellines WHERE logdate < $1', [cutoff]);

		await worker.query('COMMIT');
		worker.release();

		let nextPrune = new Date();
		nextPrune.setDate(nextPrune.getDate() + 1);
		nextPrune.setHours(0, 0, 0, 0);
		setTimeout(async () => {
			prune();
		}, nextPrune.getTime() - Date.now());
	} catch (e) {
		await worker.query('ROLLBACK');
		worker.release();
		throw e;
	}
}

// Prune any old logs on startup, also starts the timer for pruning
prune();

export class ActivityMonitor extends BaseMonitor {
	constructor(message: Discord.Message) {
		super(message, 'Activity Monitor');
	}

	public async shouldExecute() {
		return true;
	}

	public async execute() {
		if (!this.guild) return; // should never happen
		this.worker = await pgPool.connect();
		const date = new Date(); // Log date

		// Insert user line info
		let res = await this.worker.query('SELECT * FROM lines WHERE userid = $1 AND logdate = $2 AND serverid = $3', [this.author.id, date, this.guild.id]);
		if (!res.rows.length) {
			// Insert new row
			await this.worker.query('INSERT INTO lines (userid, logdate, serverid, lines) VALUES ($1, $2, $3, 1)', [this.author.id, date, this.guild.id]);
		} else {
			// update row
			await this.worker.query('UPDATE lines SET lines = lines + 1 WHERE userid = $1 AND logdate = $2 AND serverid = $3', [this.author.id, date, this.guild.id]);
		}

		// Insert channel line info - only for publicly accessible channels
		await this.guild.roles.fetch();
		const everyone = this.guild.roles.everyone; // everyone is always a role
		if (!everyone) throw new Error(`Unable to find the everyone role when logging chat.`);
		const permissions = this.channel.permissionOverwrites.get(everyone.id);
		if (permissions && permissions.deny.has('VIEW_CHANNEL')) {
			// There are custom permissions for @everyone on this channel, and @everyone cannot view the channel.
			this.worker.release();
			this.worker = null;
			return;
		}

		// Ok its public
		res = await this.worker.query('SELECT * FROM channellines WHERE channelid = $1 AND logdate = $2', [this.channel.id, date]);
		if (!res.rows.length) {
			// Insert new row
			await this.worker.query('INSERT INTO channellines (channelid, logdate, lines) VALUES ($1, $2, 1)', [this.channel.id, date]);
		} else {
			// Update row
			await this.worker.query('UPDATE channellines SET lines = lines + 1 WHERE channelid = $1 AND logdate = $2', [this.channel.id, date]);
		}

		this.worker.release();
		this.worker = null;
	}
}
