/**
 * rmt.ts
 * Commands for the rate my team monitor plugin
 * Also see src/monitors/rmt.ts
 */
import Discord = require('discord.js');
import {prefix, toID, database} from '../common';
import {BaseCommand, DiscordChannel, IAliasList, ReactionPageTurner} from '../command_base';

export const aliases: IAliasList = {
	addteamrater: ['atr'],
	removeteamrater: ['rtr'],
};

class RaterList extends ReactionPageTurner {
	protected lastPage: number;
	private guild: Discord.Guild;
	private data: any[];
	private format: string | null;
	constructor(
		channel: DiscordChannel, user: Discord.User, guild: Discord.Guild,
		data: any[], format?: string, options?: Discord.ReactionCollectorOptions
	) {
		super(channel, user, options);

		this.guild = guild;
		this.data = data;
		this.format = format || null;
		this.lastPage = Math.ceil(this.data.length / 10);
	}

	buildPage(): Discord.MessageEmbed {
		const embed: Discord.MessageEmbedOptions = {
			color: 0x6194fd,
			description: `${this.format ? this.format + ' ' : ''}Team Raters for ${this.guild.name}`,
			author: {
				name: this.guild.name,
				icon_url: this.guild.iconURL() || '',
			},
			timestamp: Date.now(),
			footer: {
				text: `Page ${this.page}/${this.lastPage || 1}`,
			},
		};

		if (this.format) {
			embed.fields = this.buildFormat();
		} else {
			embed.fields = this.buildFull();
		}

		if (!embed.fields.length) {
			embed.fields.push({
				name: 'No Team Raters Found',
				value: 'Try a more general search maybe?',
			});
		}

		return new Discord.MessageEmbed(embed);
	}

	private buildFull(): Discord.EmbedFieldData[] {
		const formats: {[format: string]: string[]} = {};
		const fields: Discord.EmbedFieldData[] = [];

		for (const row of this.data) {
			if (!formats[row.format]) formats[row.format] = [];
			formats[row.format].push(row.name + '#' + row.discriminator);
		}

		for (const format in formats) {
			fields.push({
				name: format,
				value: formats[format].join(', '),
			});
		}

		return fields;
	}

	private buildFormat(): Discord.EmbedFieldData[] {
		return [{
			name: this.format || 'List of Team Raters',
			value: this.data.map(v => `${v.name}#${v.discriminator}`).join(', ') || 'No Team Raters Found.',
		}];
	}
}

/**
 * Abstract class RMT commands extend to share access to useful methods.
 */
abstract class RmtCommand extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	/**
	 * Parse user input into a format
	 * @param formatid the id of the format
	 */
	protected checkFormat(formatid: string, silent = false): string | void {
		formatid = toID(formatid);

		const prefixRegexp = /^(?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY)/i;
		const matches = prefixRegexp.exec(formatid);
		if (matches) {
			if (matches.length !== 1) {
				if (!silent) void this.errorReply('A format can only have one generation.');
				return;
			}
			// Covert to the Gen # format
			const gens: {[key: string]: number} = {
				swsh: 8,
				ss: 8,
				usum: 7,
				sm: 7,
				oras: 6,
				xy: 6,
				b2w2: 5,
				bw2: 5,
				bw: 5,
				hgss: 4,
				dpp: 4,
				dp: 4,
				rse: 3,
				adv: 3,
				gsc: 2,
				rby: 1,
			};
			formatid = formatid.replace(matches[0], 'gen' + (gens[matches[0]] || 8));
		}

		// eslint-disable-next-line max-len
		const formatRegexp = /\b((?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY|Gen ?[1-8]\]?)? ?(?:(?:Nat|National) ?Dex|Doubles|D)? ?(?:[OURNPZ]U|AG|LC|VGC|OM|BS[SD]|(?:Over|Under|Rarely|Never|Zero)used|Ubers?|Monotype|Little ?Cup|Nat ?Dex|Anything ?Goes|Video ?Game ?Championships?|Battle ?(?:Spot|Stadium) ?(?:Singles?|Doubles?)|1v1|Other ?Meta(?:s|games?)?))\b/i;
		const format = formatRegexp.exec(formatid);
		if (!format?.length) {
			if (!silent) void this.errorReply(`\`${formatid}\` is not a valid format.`);
			return;
		}
		if (!format[0].startsWith('gen')) {
			format[0] = `gen8${format[0]}`;
		}
		if (format[0] === 'gen8natdexou') format[0] = 'gen8natdex';
		return format[0];
	}
}

export class AddTeamRater extends RmtCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		// Validate arguments
		const [username, rawFormat, rawChannel] = this.target.split(',');

		if (!toID(username) || !toID(rawFormat)) return this.reply(AddTeamRater.help());

		const user = this.getUser(username);
		if (!user) return this.errorReply(`Unable to find the user "${username}".`);

		const format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		// Check if channel exists
		let channel: DiscordChannel | void;
		if (toID(rawChannel)) {
			channel = this.getChannel(rawChannel);
			if (!channel) return this.errorReply(`Unable to find the channel "${rawChannel}".`);
		} else {
			channel = this.channel;
		}

		await this.verifyData({
			author: user,
			guild: this.guild,
			channel: channel,
		});

		// Ensure this user isnt already a rater for this format
		const res = await database.queryWithResults(
			'SELECT * FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3',
			[user.id, format, channel.id]
		);
		if (res.length) {
			// This user is already a rater for this format
			return this.errorReply(`${user} is already a team rater for ${format} in ${channel}.`);
		}

		// Add user to team raters
		await database.query(
			'INSERT INTO teamraters (userid, format, channelid) VALUES ($1, $2, $3)',
			[user.id, format, channel.id]
		);

		await this.reply(`${user.username} has been added as a team rater for ${format} in ${channel}`);
	}

	static help(): string {
		return `${prefix}addteamrater @user, format, [#channel] - Add @user as a team rater for the selected format in #channel.\n` +
			'Requires: Kick Members Permissions\n' +
			`Aliases: ${prefix}atr`;
	}
}

export class RemoveTeamRater extends RmtCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		// Validate arguments
		const [username, rawFormat, rawChannel] = this.target.split(',');

		if (!toID(username) || !toID(rawFormat)) return this.reply(RemoveTeamRater.help());

		const user = this.getUser(username);
		if (!user) return this.errorReply(`Unable to find the user "${username}".`);

		const format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		// Check if channel exists
		let channel: DiscordChannel | void;
		if (toID(rawChannel)) {
			channel = this.getChannel(rawChannel);
			if (!channel) return this.errorReply(`Unable to find the channel "${rawChannel}".`);
		} else {
			channel = this.channel;
		}

		// Ensure this user is a rater for this format in this channel
		const res = await database.queryWithResults(
			'SELECT * FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3',
			[user.id, format, channel.id]
		);
		if (!res.length) {
			// This user is not a rater for this format in this channel
			return this.errorReply(`${user.username} is not a team rater for ${format} in ${channel}.`);
		}

		// Remove user from team rater list
		await database.queryWithResults(
			'DELETE FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3',
			[user.id, format, channel.id]
		);

		await this.reply(`${user.username} is no longer a team rater for ${format} in ${channel}`);
	}

	static help(): string {
		return `${prefix}removeteamrater @user, format, [#channel] - Remove @user from being a team rater for the selected format in #channel.\n` +
			'Requires: Kick Members Permissions\n' +
			`Aliases: ${prefix}rtr`;
	}
}

export class ListRaters extends RmtCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		const [rawFormat, rawChannel, server] = this.target.split(',').map(v => v.trim());
		let allowServerName = false;
		if (!this.guild) {
			this.guild = await this.getServer(server, true, true) || null;
			if (!this.guild) {
				await this.errorReply('Because you used this command in PMs, you must provide the server argument.');
				return this.sendCode(ListRaters.help());
			}
			allowServerName = true;
		}
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		const format = this.checkFormat(rawFormat, true);
		const channel = this.getChannel(rawChannel, true, true, allowServerName);

		if (!format) {
			const res = await database.queryWithResults(
				'SELECT DISTINCT u.name, u.discriminator, tr.format FROM teamraters tr ' +
				'INNER JOIN channels ch ON tr.channelid = ch.channelid ' +
				'INNER JOIN servers s ON ch.serverid = s.serverid ' +
				'INNER JOIN users u ON tr.userid = u.userid ' +
				'WHERE s.serverid = $1 ' +
				'ORDER BY tr.format',
				[this.guild.id]
			);

			const page = new RaterList(this.channel, this.author, this.guild, res);
			await page.initialize(this.channel);
		} else if (channel) {
			const res = await database.queryWithResults(
				'SELECT u.name, u.discriminator, ch.channelname FROM teamraters tr ' +
				'INNER JOIN users u ON tr.userid = u.userid ' +
				'INNER JOIN channels ch ON tr.channelid = ch.channelid ' +
				'WHERE tr.format = $1 AND tr.channelid = $2 ' +
				'ORDER BY u.name, u.discriminator',
				[format, channel.id]
			);

			const page = new RaterList(this.channel, this.author, this.guild, res, format);
			await page.initialize(this.channel);
		} else {
			const res = await database.queryWithResults(
				'SELECT DISTINCT u.name, u.discriminator FROM teamraters tr ' +
				'INNER JOIN users u ON tr.userid = u.userid ' +
				'WHERE tr.format = $1 ' +
				'ORDER BY u.name, u.discriminator',
				[format]
			);

			const page = new RaterList(this.channel, this.author, this.guild, res, format);
			await page.initialize(this.channel);
		}
	}

	static help(): string {
		return `${prefix}listraters [format], [#channel], [server] - List the team raters for the provided format in the provided channel. If no channel is provided, the default channel is the current one.` +
		'If no format is provided, the command will list all formats and team raters for the server.\n' +
		`You can leave arguments blank in PMs (other than server) eg: ${prefix}listraters , , Server Name\n` +
		'Requires: Kick Members Permissions\n' +
		'Aliases: None';
	}
}
