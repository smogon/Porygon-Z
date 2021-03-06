/**
 * activity.ts
 * Commands related to the user and
 * channel activity monitors.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, ReactionPageTurner, DiscordChannel, IAliasList } from '../command_base';

class ActivityPage extends ReactionPageTurner {
	protected lastPage: number;
	private rowsPerPage: number;
	private data: any[];
	private granularity: string;
	private guild: Discord.Guild;
	// user/channel is for linecounts and the buildSpecific methods.
	// booleans are for leaderboard and the buildGeneral methods.
	private target: Discord.User | DiscordChannel | boolean;
	private readonly printVersions: {[key: string]: string[]} = {'day': ['Todays ', 'Daily '], 'week': ['This Weeks ', 'Weekly '], 'month': ['This Months ', 'Monthly '], 'alltime': ['All Time ', 'All Time ']};
	constructor(channel: DiscordChannel, user: Discord.User, guild: Discord.Guild, data: any[], granularity: string, target: Discord.User | DiscordChannel | boolean, options?: Discord.ReactionCollectorOptions) {
		super(channel, user, options);
		this.guild = guild;
		this.data = data;
		this.granularity = granularity;
		this.lastPage = Math.ceil(this.data.length / 10);
		this.rowsPerPage = 10;
		this.target = target;

		this.initalize(channel);
	}

	protected buildPage(): Discord.MessageEmbed {
		if (!this.target || this.target === true) {
			return this.buildGeneral();
		} else {
			return this.buildSpecific();
		}
	}

	private buildSpecific(): Discord.MessageEmbed {
		let description = '';
		if (typeof this.target === 'boolean') throw new Error('No user/channel provided for a specific activity page turner.');
		if (this.target instanceof Discord.User) {
			description = `Linecount for ${this.target.username}#${this.target.discriminator}`;
		} else {
			description = `Linecount for ${this.target.name}`;
		}

		let embed: Discord.MessageEmbedOptions = {
			color: 0x6194fd,
			description: `${this.printVersions[this.granularity][1] || ''} ${description}`,
			author: {
				name: this.guild.name,
				icon_url: this.guild.iconURL() || '',
			},
			timestamp: Date.now(),
			footer: {
				text: `Page ${this.page}/${this.lastPage || 1}`,
			}
		}
		embed.fields = []; // To appease typescript, we do this here

		for (let i = (this.page - 1) * this.rowsPerPage; i < (((this.page - 1) * this.rowsPerPage) + this.rowsPerPage); i++) {
			let row = this.data[i];
			if (!row) break; // End of data

			let date = '';
			switch (this.granularity) {
			case 'alltime':
				date = 'All Records';
				break;
			case 'month':
				const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
				date = months[row.time - 1];
				break;
			case 'week':
				date = 'Week ' + row.time;
				break;
			case 'day':
				date = row.time.toLocaleDateString(undefined, {dateStyle: 'long'});
				break;
			default:
				throw new Error(`Unsupported granularity "${this.granularity}".`);
			}

			embed.fields.push({
				name: date,
				value: `${row.sum} lines`,
			});
		}

		if (!embed.fields.length) {
			embed.fields.push({
				name: 'No Lines',
				value: 'Nobody has spoken yet.',
			});
		}

		return new Discord.MessageEmbed(embed);
	}

	private buildGeneral(): Discord.MessageEmbed {
		if (typeof this.target !== 'boolean') throw new Error(`Target user/channel passed to general activity page turner.`);
		let description = this.target ? `Most Active Channels` : `Chatter Leaderboard`;

		let embed: Discord.MessageEmbedOptions = {
			color: 0x6194fd,
			description: `${this.printVersions[this.granularity][0] || ''} ${description}`,
			author: {
				name: this.guild.name,
				icon_url: this.guild.iconURL() || '',
			},
			timestamp: Date.now(),
			footer: {
				text: `Page ${this.page}/${this.lastPage || 1}`,
			}
		}
		embed.fields = []; // To appease typescript, we do this here

		for (let i = (this.page - 1) * this.rowsPerPage; i < (((this.page - 1) * this.rowsPerPage) + this.rowsPerPage); i++) {
			let row = this.data[i];
			if (!row) break; // End of data
			if (this.target) {
				embed.fields.push({
					name: `${i + 1}. ${row.channelname}`,
					value: `${row.sum} lines`,
				});
			} else {
				embed.fields.push({
					name: `${i + 1}. ${row.name}#${row.discriminator}`,
					value: `${row.sum} lines`,
				});
			}
		}

		if (!embed.fields.length) {
			embed.fields.push({
				name: 'No Lines',
				value: 'Nobody has spoken yet.',
			});
		}

		return new Discord.MessageEmbed(embed);
	}
}

export const aliases: IAliasList = {
	leaderboard: ['lb'],
	channelleaderboard: ['clb'],
	linecount: ['lc'],
	channellinecount: ['clc'],
};

export class Leaderboard extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	protected async fetchData(granularity: string): Promise<any[]> {
		if (!this.guild) {
			// This should never happen because this method is only called after this.guild is checked
			throw new Error(`Unable to find guild when fetching data for leaderboard.`);
		}
		let args = [this.guild.id];
		let query = `SELECT u.name, u.discriminator, SUM(l.lines) FROM lines l INNER JOIN users u ON u.userid = l.userid WHERE l.serverid = $1`;
		const d = new Date();
		const dateString = d.toLocaleDateString(undefined, {month: '2-digit', day: '2-digit', year: 'numeric'});

		switch (granularity) {
		case 'alltime':
			// Do nothing here
			break;
		case 'month':
			query += ` AND EXTRACT(MONTH FROM l.logdate) = $2`;
			args.push("" + (d.getMonth() + 1));
			break;
		case 'week':
			query += ` AND EXTRACT(WEEK FROM l.logdate) = EXTRACT(WEEK FROM CAST($2 AS DATE))`;
			args.push(dateString);
			break;
		case 'day':
			query += ` AND l.logdate = $2`;
			args.push(dateString);
			break;
		default:
			throw new Error(`Unsupported granulity: ${granularity}`);
		}

		query += ` GROUP BY u.name, u.discriminator ORDER BY SUM(l.lines) desc;`;
		let res = await pgPool.query(query, args);

		return res.rows;
	}

	public async execute() {
		let [granularity, server] = this.target.trim().split(',').map(v => v.trim());
		if (!this.guild) {
			this.guild = await this.getServer(server, true, true) || null;
			if (!this.guild) {
				this.errorReply(`Because you used this command in PMs, you must provide the server argument.`);
				return this.sendCode(Leaderboard.help());
			}
		}

		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');
		if (!toID(granularity)) granularity = 'alltime';
		if (!['day', 'week', 'month', 'alltime'].includes(granularity)) return this.sendCode(Leaderboard.help());

		let res = await this.fetchData(granularity);
		new ActivityPage(this.channel, this.author, this.guild, res, granularity, false);
	}

	public static help(): string {
		return `${prefix}leaderboard [day | week | month | alltime], [server] - Gets the public chat leaderboard for the selected timeframe. Timeframe defaults to alltime.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: ${aliases.leaderboard.map(a => `${prefix}${a} `)}\n` +
			`Related Commands: channelleaderboard, linecount, channellinecount`;
	}
}

export class ChannelLeaderboard extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	protected async fetchData(granularity: string): Promise<any[]> {
		if (!this.guild) {
			// This should never happen because this method is only called after this.guild is checked
			throw new Error(`Unable to find guild when fetching data for channel leaderboard.`);
		}
		let args = [this.guild.id];
		let query = `SELECT ch.channelname, SUM(cl.lines) FROM channellines cl INNER JOIN channels ch ON cl.channelid = ch.channelid`;
		query += ` INNER JOIN servers s ON ch.serverid = s.serverid WHERE ch.serverid = $1`;
		const d = new Date();
		const dateString = d.toLocaleDateString(undefined, {month: '2-digit', day: '2-digit', year: 'numeric'});

		switch (granularity) {
		case 'alltime':
			// Do nothing here
			break;
		case 'month':
			query += ` AND EXTRACT(MONTH FROM cl.logdate) = $2`;
			args.push("" + (d.getMonth() + 1));
			break;
		case 'week':
			query += ` AND EXTRACT(WEEK FROM cl.logdate) = EXTRACT(WEEK FROM CAST($2 AS DATE))`;
			args.push(dateString);
			break;
		case 'day':
			query += ` AND cl.logdate = $2`;
			args.push(dateString);
			break;
		default:
			throw new Error(`Unsupported granulity: ${granularity}`);
		}

		query += ` GROUP BY ch.channelname ORDER BY SUM(cl.lines) desc;`;
		let res = await pgPool.query(query, args);

		return res.rows;
	}

	public async execute() {
		let [granularity, server] = this.target.trim().split(',').map(v => v.trim());
		if (!this.guild) {
			this.guild = await this.getServer(server, true, true) || null;
			if (!this.guild) {
				this.errorReply(`Because you used this command in PMs, you must provide the server argument.`);
				return this.sendCode(ChannelLeaderboard.help());
			}
		}

		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');
		if (!toID(granularity)) granularity = 'alltime';
		if (!['day', 'week', 'month', 'alltime'].includes(granularity)) return this.sendCode(ChannelLeaderboard.help());

		let res = await this.fetchData(granularity);
		new ActivityPage(this.channel, this.author, this.guild, res, granularity, true);
	}

	public static help(): string {
		return `${prefix}channelleaderboard [day | week | month | alltime], [server] - Gets the activity leaderboard for public channels in the selected timeframe. Timeframe defaults to alltime.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: ${aliases.channelleaderboard.map(a => `${prefix}${a} `)}\n` +
			`Related Commands: leaderboard, linecount, channellinecount`;
	}
}

export class Linecount extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	protected async fetchData(granularity: string, id?: string): Promise<any[]> {
		if (!this.guild) {
			// This should never happen because this method is only called after this.guild is checked
			throw new Error(`Unable to find guild when fetching data for user linecount.`);
		}
		let key = '';

		switch (granularity) {
		case 'alltime':
			// Do nothing here
			break;
		case 'month':
			key = `EXTRACT(MONTH FROM l.logdate)`;
			break;
		case 'week':
			key = `EXTRACT(WEEK FROM l.logdate)`;
			break;
		case 'day':
			key = `l.logdate`;
			break;
		default:
			throw new Error(`Unsupported granulity: ${granularity}`);
		}

		let query = `SELECT ${key ? key + ' AS time, ' : ''}SUM(l.lines) FROM lines l WHERE l.serverid = $1 AND l.userid = $2`;
		if (key) query += ` GROUP BY ${key} ORDER BY ${key} desc;`;
		let args = [this.guild.id, id];
		let res = await pgPool.query(query, args);

		return res.rows;
	}

	public async execute() {
		let [rawTarget, granularity, server] = this.target.trim().split(',').map(v => v.trim());
		if (!this.guild) {
			this.guild = await this.getServer(server, true, true) || null;
			if (!this.guild) {
				this.errorReply(`Because you used this command in PMs, you must provide the server argument.`);
				return this.reply(Linecount.help());
			}
		}

		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');
		let target = this.getUser(rawTarget);
		if (!target) return this.sendCode(Linecount.help());

		if (!toID(granularity)) granularity = 'day';
		if (!['day', 'week', 'month', 'alltime'].includes(granularity)) return this.sendCode(Linecount.help());

		let res = await this.fetchData(granularity, target.id);
		new ActivityPage(this.channel, this.author, this.guild, res, granularity, target);
	}

	public static help(): string {
		return `${prefix}linecount @user, [day | week | month | alltime], [server] - Gets a user's public activity in the selected timeframe. Timeframe defaults to day.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: ${aliases.linecount.map(a => `${prefix}${a} `)}\n` +
			`Related Commands: leaderboard, channelleaderboard, channellinecount`;
	}
}

export class ChannelLinecount extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	protected async fetchData(granularity: string, id?: string): Promise<any[]> {
		if (!this.guild) {
			// This should never happen because this method is only called after this.guild is checked
			throw new Error(`Unable to find guild when fetching data for channel linecount.`);
		}
		let key = '';

		switch (granularity) {
		case 'alltime':
			// Do nothing here
			break;
		case 'month':
			key = `EXTRACT(MONTH FROM cl.logdate)`;
			break;
		case 'week':
			key = `EXTRACT(WEEK FROM cl.logdate)`;
			break;
		case 'day':
			key = `cl.logdate`;
			break;
		default:
			throw new Error(`Unsupported granulity: ${granularity}`);
		}

		let query = `SELECT ${key ? key + ' AS time, ' : ''}SUM(cl.lines) FROM channellines cl INNER JOIN channels ch ON cl.channelid = ch.channelid`;
		query += ` WHERE ch.serverid = $1 AND ch.channelid = $2`;
		if (key) query += ` GROUP BY ${key} ORDER BY ${key} desc;`;
		let args = [this.guild.id, id];
		let res = await pgPool.query(query, args);

		return res.rows;
	}

	public async execute() {
		let [rawTarget, granularity, server] = this.target.trim().split(',').map(v => v.trim());
		if (!this.guild) {
			this.guild = await this.getServer(server, true, true) || null;
			if (!this.guild) {
				this.errorReply(`Because you used this command in PMs, you must provide the server argument.`);
				return this.sendCode(ChannelLinecount.help());
			}
		}

		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');
		let target = this.getChannel(rawTarget, true, true, true);
		if (!target) return this.reply(ChannelLinecount.help());

		if (!toID(granularity)) granularity = 'day';
		if (!['day', 'week', 'month', 'alltime'].includes(granularity)) return this.sendCode(ChannelLinecount.help());

		let res = await this.fetchData(granularity, target.id);
		new ActivityPage(this.channel, this.author, this.guild, res, granularity, target);
	}

	public static help(): string {
		return `${prefix}channellinecount #channel, [day | week | month | alltime], [server] - Gets a public channel's activity in the selected timeframe. Timeframe defaults to day.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: ${aliases.channellinecount.map(a => `${prefix}${a} `)}\n` +
			`Related Commands: leaderboard, channelleaderboard, linecount`;
	}
}
