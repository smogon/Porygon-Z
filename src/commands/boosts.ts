/**
 * boosts.ts
 * Nitro Boost related commands
 */
import Discord = require('discord.js');
import { client } from '../app';
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, ReactionPageTurner, DiscordChannel, IAliasList } from '../command_base';

async function updateBoosters() {
	const worker = await pgPool.connect();

	//await client.guilds.
	for (const [guildId, guild] of client.guilds.cache) {
		let res = await worker.query('SELECT userid FROM userlist WHERE serverid = $1 AND boosting IS NOT NULL', [guildId]);
		const boosting = res.rows.map(r => {
			return r.userid;
		});
		const logChannel = client.channels.cache.get((await pgPool.query(`SELECT logchannel FROM servers WHERE serverid = $1`, [guildId])).rows[0].logchannel) as DiscordChannel;

		for (let [id, gm] of guild.members.cache) {
			if (gm.premiumSince) {
				if (boosting.includes(id)) {
					boosting.splice(boosting.indexOf(id), 1);
					continue; // Already marked as boosting
				}
				// Check if booster is in users table/userlist
				if (!(await worker.query('SELECT userid FROM users WHERE userid = $1', [id])).rows.length) {
					await worker.query('INSERT INTO users (userid, name, discriminator) VALUES ($1, $2, $3)', [gm.user.id, gm.user.username, gm.user.discriminator]);
				}
				if (!(await worker.query('SELECT userid FROM userlist WHERE userid = $1 AND serverid = $2', [id, guildId])).rows.length) {
					// Insert with update
					await worker.query('INSERT INTO userlist (serverid, userid, boosting) VALUES ($1, $2, $3)', [guildId, id, gm.premiumSince]);
				} else {
					// Just update
					await worker.query('UPDATE userlist SET boosting = $1 WHERE serverid = $2 AND userid = $3', [gm.premiumSince, guildId, id]);
				}
				if (logChannel) logChannel.send(`<@${id}> has started boosting!`);
			} else {
				if (!boosting.includes(id)) continue; // Was not bosting before
				await worker.query('UPDATE userlist SET boosting = NULL WHERE serverid = $1 AND userid = $2', [guildId, id]);
				if (logChannel) logChannel.send(`<@${id}> is no longer boosting.`);
				boosting.splice(boosting.indexOf(id), 1);
			}
		}

		// Anyone left in boosting left the server and is no longer boosting
		for (let desterter of boosting) {
			await worker.query('UPDATE userlist SET boosting = NULL WHERE serverid = $1 AND userid = $2', [guildId, desterter]);
			if (logChannel) logChannel.send(`<@${desterter}> is no longer boosting because they left the server.`);
		}
	}

	worker.release();

	// Schedule next boost check
	let nextCheck = new Date();
	nextCheck.setDate(nextCheck.getDate() + 1);
	nextCheck.setHours(0, 0, 0, 0);
	setTimeout(() => updateBoosters(), nextCheck.getTime() - Date.now());
}

// Update boosters, wait a few seconds so the bot's servers are loaded
setTimeout(() => {
	updateBoosters();
}, 5000);

class BoostPage extends ReactionPageTurner {
	protected lastPage: number;
	private rowsPerPage: number;
	private data: any[];
	constructor(channel: DiscordChannel, user: Discord.User, data: any[]) {
		super(channel, user);
		this.data = data;
		this.lastPage = Math.ceil(this.data.length / 10);
		this.rowsPerPage = 10;

		this.initalize(channel);
	}

	buildPage(guild: Discord.Guild): Discord.MessageEmbed {
		let embed: Discord.MessageEmbedOptions = {
			color: 0xf47fff,
			description: `Current Nitro Boosters`,
			author: {
				name: guild.name,
				icon_url: guild.iconURL() || '',
			},
			timestamp: Date.now(),
			footer: {
				text: `Server ID: ${guild.id}`,
			}
		}
		embed.fields = []; // To appease typescript, we do this here

		for (let i = (this.page - 1) * 10; i < (((this.page - 1) * 10) + this.rowsPerPage); i++) {
			const row = this.data[i];
			if (!row) break; // No more data

			let d = row.boosting.toUTCString();
			d = d.slice(0, d.indexOf(':') - 3);
			embed.fields.push({
				name: row.name + '#' + row.discriminator,
				value: `Since ${d}`,
			});
		}

		if (!embed.fields.length) embed.fields.push({
			name: 'No Boosters',
			value: 'Try this command again once you have a nitro booster.',
		});

		return new Discord.MessageEmbed(embed);
	}
}

export class Boosters extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		if (!(await this.can('MANAGE_ROLES'))) return this.errorReply(`Access Denied.`);

		let res = await pgPool.query('SELECT u.name, u.discriminator, ul.boosting ' +
			'FROM users u ' +
			'INNER JOIN userlist ul ON u.userid = ul.userid ' +
			'INNER JOIN servers s ON s.serverid = ul.serverid ' +
			'WHERE s.serverid = $1 AND ul.boosting IS NOT NULL', [this.guild.id]);

		new BoostPage(this.channel, this.author, res.rows);
	}

	public static help(): string {
		return `${prefix}boosters - List this server's current Nitro Boosters and when they started boosting. Results may be out of date by up to 24 hours.\n` +
			`Requires: Manage Roles Permissions\n` +
			`Aliases: None`;
	}
}
