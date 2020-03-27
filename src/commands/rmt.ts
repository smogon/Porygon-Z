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
	 * Check if a channel exists in the database and insert it if not.
	 * @param rawChannel The channelid to look for.
	 */
	protected checkChannel(rawChannel: string): Discord.TextChannel | void {
		// Check if channel exists
		let channelid = '';
		let channel: Discord.TextChannel;
		if (!toID(rawChannel)) {
			if (this.channel.type !== 'text') return this.errorReply(`This command cannot be used in a DM or Group Chat.`);
			channelid = this.channel.id;
			channel = (this.channel as Discord.TextChannel);
		} else if (/<#\d{18}>/.test(rawChannel)) {
			rawChannel = rawChannel.trim();
			channelid = rawChannel.substring(2, rawChannel.length - 1);
			let tempChannel = this.getChannel(channelid);
			if (!tempChannel || tempChannel.type !== 'text') return this.errorReply(`This command cannot be used in a DM or Group Chat.`);
			channel = (tempChannel as Discord.TextChannel);
		} else {
			return this.errorReply(`Command usage: ${prefix}${this.cmd} @User OR User#tag, format, (#channel). #channel defaults to the current one if not provided.`);
		}
		if (channel.guild.id !== this.guild.id) return this.errorReply('Channel must be in this server.');

		return channel;
	}

	/**
	 * Check if a user exists in the database and insert it if not.
	 * @param username The userid to look for.
	 */
	protected checkUser(username: string): Discord.User | void {
		let user: Discord.User | undefined;
		username = username.trim();
		if (/<@!?\d{18}>/.test(username)) {
			// tag, aka userid
			let startingIndex = username.includes('!') ? 3 : 2;
			user = this.getUser(username.substring(startingIndex, username.length - 1));
			if (!user) return this.errorReply(`Unable to find the user "${username}".`);
		} else if (/[^@#:]{1,32}#\d{4}/.test(username)) {
			// try to extract from a username + discriminator (eg: Name#1111)
			user = this.findUser(username.split('#')[0], username.split('#')[1]);
			if (!user) return this.errorReply(`Unable to find the user "${username}".`);
		} else {
			return this.errorReply(`Command usage: ${prefix}${this.cmd} @User OR User#tag, format, (#channel). #channel defaults to the current one if not provided.`);
		}
		return user;
	}

	protected checkFormat(formatid: string): string | void {
		formatid = toID(formatid);

		let prefixRegexp = /^(?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY)/i;
		let matches = prefixRegexp.exec(formatid);
		if (matches) {
			if (matches.length !== 1) return this.errorReply('A format can only have one generation.');
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
		if (!formatid.startsWith('gen')) return this.errorReply(`You must specify a generation for the format`);

		let formatRegexp = /\b((?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY|Gen ?[1-8]\]?)? ?(?:(?:(?:Nat|National) ?Dex|Doubles|D)? ?[OURNP]U|AG|LC|VGC|OM|(?:Over|Under|Rarely|Never)used)|Ubers?|Monotype|Little ?Cup|Nat ?Dex|Anything Goes|Video Game Championships?|Other ?Meta(?:s|games?)?)\b/i;
		let format = formatRegexp.exec(formatid);
		if (!format || !format.length) return this.errorReply(`\`${formatid}\` is not a valid format.`);
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

		let user = this.checkUser(username);
		if (!user) return; // Error message handled in checkUser
		if (!(await this.insertUser(user.id))) throw new Error('Unable to insert user \`${user.id}\` into database.');

		let format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled in checkFormat

		// Check if channel exists
		let channel = this.checkChannel(rawChannel);
		if (!channel) return; // Error message handled in checkChannel
		if (!(await this.insertChannel(channel.id))) throw new Error('Unable to insert channel \`${channel.id}\` into database.');

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

		let user = this.checkUser(username);
		if (!user) return; // Error message handled by checkUser

		let format = this.checkFormat(rawFormat);
		if (!format) return; // Error message handled by checkFormat

		let channel = this.checkChannel(rawChannel);
		if (!channel) return; // Error message handled by checkChannel

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
