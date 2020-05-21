/**
 * rmt.ts
 * Commands for the rate my team monitor plugin
 * Also see src/monitors/rmt.ts
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';

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
		if (!formatid.startsWith('gen')) {
			this.errorReply(`You must specify a generation for the format`);
			return;
		}

		let formatRegexp = /\b((?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY|Gen ?[1-8]\]?)? ?(?:(?:(?:Nat|National) ?Dex|Doubles|D)? ?[OURNP]U|AG|LC|VGC|OM|(?:Over|Under|Rarely|Never)used)|Ubers?|Monotype|Little ?Cup|Nat ?Dex|Anything Goes|Video Game Championships?|Other ?Meta(?:s|games?)?)\b/i;
		let format = formatRegexp.exec(formatid);
		if (!format || !format.length) {
			this.errorReply(`\`${formatid}\` is not a valid format.`);
			return;
		}
		return format[0];
	}
}

export class AddTeamRater extends RmtCommand{
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		// !addteamrater @user, format, #channel
		// !addteamrater User#1111, format, #channel
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		// Validate arguments
		let [username, rawFormat, rawChannel] = this.target.split(',');

		let user = this.getUser(username);
		if (!user) return this.errorReply(`Unable to find the user "${username}".`);

		let format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		// Check if channel exists
		let channel = this.getChannel(rawChannel, true);
		if (!channel) return this.errorReply(`Unable to find the channel "${rawChannel}".`);

		this.worker = await pgPool.connect();

		// Ensure this user isnt already a rater for this format
		let res = await this.worker.query(`SELECT * FROM teamraters WHERE userid = $1 AND format = $2 AND channelid = $3`, [user.id, format, channel.id]);
		if (res.rows.length) {
			// This user is already a rater for this format
			return this.errorReply(`${user} is already a team rater for ${format} in ${channel}.`);
		}

		// Add user to team raters
		await this.worker.query('INSERT INTO teamraters (userid, format, channelid) VALUES ($1, $2, $3)', [user.id, format, channel.id]);
		this.worker.release();

		this.reply(`${user.username} has been added as a team rater for ${format} in ${channel}`);
	}
}

export class RemoveTeamRater extends RmtCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		// !removeteamrater @user, format, #channel
		// !removeteamrater User#1111, format, #channel
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied');

		// Validate arguments
		let [username, rawFormat, rawChannel] = this.target.split(',');

		let user = this.getUser(username);
		if (!user) return this.errorReply(`Unable to find the user "${username}".`);

		let format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		let channel = this.getChannel(rawChannel, true);
		if (!channel) return this.errorReply(`Unable to find the channel "${rawChannel}".`);

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
}
