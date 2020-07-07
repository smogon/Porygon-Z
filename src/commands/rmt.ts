/**
 * rmt.ts
 * Commands for the rate my team monitor plugin
 * Also see src/monitors/rmt.ts
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';

export const aliases: IAliasList = {
	addteamrater: ['atr'],
	removeteamrater: ['rtr'],
};

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
	protected checkFormat(formatid: string): string | void {
		formatid = toID(formatid);

		let prefixRegexp = /^(?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY)/i;
		let matches = prefixRegexp.exec(formatid);
		if (matches) {
			if (matches.length !== 1) {
				this.errorReply('A format can only have one generation.');
				return;
			}
			// Covert to the Gen # format
			let gens: {[key: string]: number} = {
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

		let formatRegexp = /\b((?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY|Gen ?[1-8]\]?)? ?(?:(?:(?:Nat|National) ?Dex|Doubles|D)? ?[OURNP]U|AG|LC|VGC|OM|BS[SD]|(?:Over|Under|Rarely|Never)used|Ubers?|Monotype|Little ?Cup|Nat ?Dex|Anything ?Goes|Video ?Game ?Championships?|Battle ?(?:Spot|Stadium) ?(?:Singles?|Doubles?)|1v1|Other ?Meta(?:s|games?)?))\b/i;
		let format = formatRegexp.exec(formatid);
		if (!format || !format.length) {
			this.errorReply(`\`${formatid}\` is not a valid format.`);
			return;
		}
		if (!format[0].startsWith('gen')) {
			format[0] = `gen8${format[0]}`;
		}
		return format[0];
	}
}

export class AddTeamRater extends RmtCommand{
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		// Validate arguments
		let [username, rawFormat, rawChannel] = this.target.split(',');

		if (!toID(username) || !toID(rawFormat)) return this.reply(AddTeamRater.help());

		let user = this.getUser(username);
		if (!user) return this.errorReply(`Unable to find the user "${username}".`);

		let format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		// Check if channel exists
		let channel: DiscordChannel | void;
		if (toID(rawChannel)) {
			channel = this.getChannel(rawChannel, true);
			if (!channel) return this.errorReply(`Unable to find the channel "${rawChannel}".`);
		} else {
			channel = this.channel;
		}

		this.worker = await pgPool.connect();

		// Ensure this user isnt already a rater for this format
		let res = await this.worker.query(`SELECT * FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3`, [user.id, format, channel.id]);
		if (res.rows.length) {
			// This user is already a rater for this format
			this.releaseWorker();
			return this.errorReply(`${user} is already a team rater for ${format} in ${channel}.`);
		}

		// Add user to team raters
		await this.worker.query('INSERT INTO teamraters (userid, format, channelid) VALUES ($1, $2, $3)', [user.id, format, channel.id]);
		this.releaseWorker();

		this.reply(`${user.username} has been added as a team rater for ${format} in ${channel}`);
	}

	public static help(): string {
		return `${prefix}addteamrater @user, format, [#channel] - Add @user as a team rater for the selected format in #channel.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: ${prefix}atr`;
	}
}

export class RemoveTeamRater extends RmtCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		// Validate arguments
		let [username, rawFormat, rawChannel] = this.target.split(',');

		if (!toID(username) || !toID(rawFormat)) return this.reply(RemoveTeamRater.help());

		let user = this.getUser(username);
		if (!user) return this.errorReply(`Unable to find the user "${username}".`);

		let format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		// Check if channel exists
		let channel: DiscordChannel | void;
		if (toID(rawChannel)) {
			channel = this.getChannel(rawChannel, true);
			if (!channel) return this.errorReply(`Unable to find the channel "${rawChannel}".`);
		} else {
			channel = this.channel;
		}

		// Ensure this user is a rater for this format in this channel
		let res = await pgPool.query(`SELECT * FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3`, [user.id, format, channel.id]);
		if (!res.rows.length) {
			// This user is not a rater for this format in this channel
			return this.errorReply(`${user.username} is not a team rater for ${format} in ${channel}.`);
		}

		// Remove user from team rater list
		await pgPool.query(`DELETE FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3`, [user.id, format, channel.id]);

		this.reply(`${user.username} is no longer a team rater for ${format} in ${channel}`);
	}

	public static help(): string {
		return `${prefix}removeteamrater @user, format, [#channel] - Remove @user from being a team rater for the selected format in #channel.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: ${prefix}rtr`;
	}
}
