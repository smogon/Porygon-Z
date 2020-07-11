/**
 * moderation.ts
 * Commands useful for server moderators
 * and administrators.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';

export class Whois extends BaseCommand {
	private readonly KEY_PERMISSIONS: {[key: string]: string}
	constructor(message: Discord.Message) {
		super(message);
		this.KEY_PERMISSIONS = {
			'ADMINISTRATOR': 'Server Admin',
			'BAN_MEMBERS': 'Ban Members',
			'KICK_MEMBERS': 'Kick Members',
			'MANAGE_CHANNELS': 'Edit Channels',
			'MANAGE_GUILD': 'Edit Server',
			'MANAGE_ROLES': 'Assign Roles',
			'MANAGE_WEBHOOKS': 'Configure Webhooks',
			'MOVE_MEMBERS': 'Move Members in Voice Calls',
			'MUTE_MEMBERS': 'Mute Members',
			'VIEW_AUDIT_LOG': 'View Audit Log',
		};
	}

	private async getJoinPosition(user: Discord.GuildMember): Promise<string> {
		const guild = user.guild;
		await guild.members.fetch();
		let orderedList = guild.members.cache.array().sort((a, b) => {
			return (a.joinedTimestamp || Date.now()) - (b.joinedTimestamp || Date.now());
		});

		return `${orderedList.indexOf(user) + 1} of ${orderedList.length}`;
	}

	public async execute() {
		if (!this.guild) return this.errorReply(`This command is not mean't to be used in PMs.`);
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply(`Access Denied.`);

		let user = this.getUser(this.target);
		if (!user) return this.errorReply(`The user "${this.target}" was not found.`);
		let guildUser = await this.guild.members.fetch(user.id);

		let embed: Discord.MessageEmbedOptions = {
			color: 0x6194fd,
			description: `Information of ${user}.`,
			author: {
				name: user.tag,
				icon_url: user.displayAvatarURL(),
			},
			fields: [
				{
					name: 'Joined',
					value: guildUser.joinedAt ? guildUser.joinedAt.toUTCString() : 'N/A',
				},
				{
					name: 'Join Position',
					value: await this.getJoinPosition(guildUser),
				},
				{
					name: 'Registered',
					value: user.createdAt.toUTCString(),
				},
				{
					name: 'Roles',
					value: guildUser.roles.cache.map(r => r.name === '@everyone' ? '' : r.toString()).join(' ').trim() || 'No Roles',
				},
				{
					name: 'Key Permissions',
					value: guildUser.permissions.toArray().filter(p => (p in this.KEY_PERMISSIONS)).map(p => this.KEY_PERMISSIONS[p]).join(', ') || 'None',
				}
			],
			timestamp: Date.now(),
			footer: {
				text: `User ID: ${user.id}`,
			}
		}

		this.channel.send({embed: embed});
	}

	public static help(): string {
		return `${prefix}whois @user - Get detailed information on the selected user.\n` +
			`Requires: Kick Members Permissions\n` +
			`Aliases: None`;
	}
}

export class EnableLogs extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply(`This command is not mean't to be used in PMs.`);
		if (!(await this.can('MANAGE_GUILD'))) return this.errorReply('Access Denied');
		this.worker = await pgPool.connect();

		let res = await this.worker.query('SELECT logchannel FROM servers WHERE serverid = $1', [this.guild.id]);
		if (res.rows[0].logchannel) return this.errorReply(`This server is already setup to log to <#${res.rows[0].logchannel}>.`);

		await this.worker.query('UPDATE servers SET logchannel = $1 WHERE serverid = $2', [this.channel.id, this.guild.id]);
		this.reply(`Server events will now be logged to this channel.`);

		this.worker.release();
		this.worker = null;
	}

	public static help(): string {
		return `${prefix}enablelogs - Log moderation actions to this channel.\n` +
			`Requires: Manage Server Permissions\n` +
			`Aliases: None`;
	}
}

export class DisableLogs extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply(`This command is not mean't to be used in PMs.`);
		if (!(await this.can('MANAGE_GUILD'))) return this.errorReply('Access Denied');
		this.worker = await pgPool.connect();

		let res = await this.worker.query('SELECT logchannel FROM servers WHERE serverid = $1', [this.guild.id]);
		if (!res.rows[0].logchannel) return this.errorReply(`This server is not setup to log messages to a log channel.`);

		await this.worker.query('UPDATE servers SET logchannel = $1 WHERE serverid = $2', [null, this.guild.id]);
		this.reply(`Server events will no longer be logged to this channel.`);

		this.worker.release();
		this.worker = null;
	}

	public static help(): string {
		return `${prefix}disablelogs - Stop logging moderation actions to this channel.\n` +
			`Requires: Manage Server Permissions\n` +
			`Aliases: None`;
	}
}
