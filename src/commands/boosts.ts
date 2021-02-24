/**
 * boosts.ts
 * Nitro Boost related commands
 */
import Discord = require('discord.js');
import {client, verifyData} from '../app';
import {prefix, pgPool} from '../common';
import {BaseCommand, ReactionPageTurner, DiscordChannel} from '../command_base';

async function updateBoosters() {
	const worker = await pgPool.connect();

	for (const [guildId, guild] of client.guilds.cache) {
		const res = await worker.query('SELECT userid FROM userlist WHERE serverid = $1 AND boosting IS NOT NULL', [guildId]);
		const boosting = res.rows.map(r => r.userid);
		const logchannelResult = await pgPool.query(`SELECT logchannel FROM servers WHERE serverid = $1`, [guildId]);
		const logChannel = client.channels.cache.get(logchannelResult.rows[0].logchannel) as DiscordChannel;
		await guild.members.fetch();

		for (const [id, gm] of guild.members.cache) {
			if (gm.premiumSince) {
				if (boosting.includes(id)) {
					boosting.splice(boosting.indexOf(id), 1);
					continue; // Already marked as boosting
				}

				await verifyData({
					author: gm.user,
					guild: gm.guild,
				});

				// Check if booster is in users table/userlist
				if (!(await worker.query('SELECT userid FROM users WHERE userid = $1', [id])).rows.length) {
					await worker.query(
						'INSERT INTO users (userid, name, discriminator) VALUES ($1, $2, $3)',
						[gm.user.id, gm.user.username, gm.user.discriminator]
					);
				}

				const users = await worker.query('SELECT userid FROM userlist WHERE userid = $1 AND serverid = $2', [id, guildId]);
				if (!users.rows.length) {
					// Insert with update
					await worker.query(
						'INSERT INTO userlist (serverid, userid, boosting) VALUES ($1, $2, $3)',
						[guildId, id, gm.premiumSince]
					);
				} else {
					// Just update
					await worker.query(
						'UPDATE userlist SET boosting = $1 WHERE serverid = $2 AND userid = $3',
						[gm.premiumSince, guildId, id]
					);
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
		for (const desterter of boosting) {
			await worker.query('UPDATE userlist SET boosting = NULL WHERE serverid = $1 AND userid = $2', [guildId, desterter]);
			if (logChannel) logChannel.send(`<@${desterter}> is no longer boosting because they left the server.`);
		}
	}

	worker.release();

	// Schedule next boost check
	const nextCheck = new Date();
	nextCheck.setDate(nextCheck.getDate() + 1);
	nextCheck.setHours(0, 0, 0, 0);
	setTimeout(() => updateBoosters(), nextCheck.getTime() - Date.now());
}

class BoostPage extends ReactionPageTurner {
	protected lastPage: number;
	private rowsPerPage: number;
	private guild: Discord.Guild;
	private data: any[];
	constructor(channel: DiscordChannel, user: Discord.User, guild: Discord.Guild, data: any[]) {
		super(channel, user);
		this.guild = guild;
		this.data = data;
		this.lastPage = Math.ceil(this.data.length / 10) || 1;
		this.rowsPerPage = 10;

		this.initalize(channel);
	}

	buildPage(): Discord.MessageEmbed {
		const embed: Discord.MessageEmbedOptions = {
			color: 0xf47fff,
			description: `Current Nitro Boosters`,
			author: {
				name: this.guild.name,
				icon_url: this.guild.iconURL() || '',
			},
			timestamp: Date.now(),
			footer: {
				text: `Page ${this.page}/${this.lastPage}`,
			},
		};
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

		if (!embed.fields.length) {
			embed.fields.push({
				name: 'No Boosters',
				value: 'Try this command again once you have a nitro booster.',
			});
		}

		return new Discord.MessageEmbed(embed);
	}
}

export class Boosters extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply(`This command is not mean't to be used in PMs.`);
		if (!(await this.can('MANAGE_ROLES'))) return this.errorReply(`Access Denied.`);

		const res = await pgPool.query('SELECT u.name, u.discriminator, ul.boosting ' +
			'FROM users u ' +
			'INNER JOIN userlist ul ON u.userid = ul.userid ' +
			'INNER JOIN servers s ON s.serverid = ul.serverid ' +
			'WHERE s.serverid = $1 AND ul.boosting IS NOT NULL ' +
			'ORDER BY ul.boosting', [this.guild.id]);

		new BoostPage(this.channel, this.author, this.guild, res.rows);
	}

	static help(): string {
		return `${prefix}boosters - List this server's current Nitro Boosters and when they started boosting. Results may be out of date by up to 24 hours.\n` +
			`Requires: Manage Roles Permissions\n` +
			`Aliases: None`;
	}

	static async init(): Promise<void> {
		updateBoosters();
	}
}
