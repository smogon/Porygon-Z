/**
 * moderation.ts
 * Commands useful for server moderators
 * and administrators.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';
import { client } from '../app';

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

/**
 * Sticky Roles
 */

abstract class StickyCommand extends BaseCommand {
	async canAssignRole(user: Discord.GuildMember, role: Discord.Role): Promise<boolean> {
		if (!this.guild || user.guild.id !== this.guild.id || role.guild.id !== this.guild.id) throw new Error(`Guild missmatch in sticky command`);
		// This method does NOT perform a manage roles permission check.
		// It simply checks if a user would be able to assign the role provided
		// assuming they have permissions to assign roles.

		// Bot owner override
		if (await this.can('EVAL', user.user)) return true;

		// Server owner override
		if (this.guild.ownerID === user.user.id) return true;

		await this.guild.roles.fetch();
		const highestRole = [...user.roles.cache.values()].sort((a, b) => {
			return b.comparePositionTo(a);
		})[0];
		if (role.comparePositionTo(highestRole) >= 0) return false;
		return true;
	}

	async massStickyUpdate(role: Discord.Role, unsticky: boolean = false): Promise<void> {
		if (!this.guild || this.guild.id !== role.guild.id) throw new Error(`Guild missmatch in sticky command`);
		if (!role.members.size) return; // No members have this role, so no database update needed

		await this.guild.members.fetch();
		let query = `UPDATE userlist SET sticky = ${unsticky ? 'array_remove' : 'array_append'}(sticky, $1) WHERE serverid = $2 AND userid IN (`;
		let argInt = 3;
		let args = [role.id, role.guild.id];
		for (let [key, member] of role.members) {
			await this.verifyData({author: member.user, guild: this.guild});
			query += `$${argInt}, `;
			args.push(member.user.id);
			argInt++;
		}
		query = query.slice(0, query.length - 2);
		query += `);`;

		await pgPool.query(query, args);
	}
}

export class Sticky extends StickyCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!toID(this.target)) return this.reply(Sticky.help());
		if (!this.guild) return this.errorReply(`This command is not mean't to be used in PMs.`);
		if (!(await this.can('MANAGE_ROLES'))) return this.errorReply(`Access Denied`);
		const bot = this.guild.me ? this.guild.me.user : null;
		if (!bot) throw new Error(`Bot user not found.`);
		if (!(await this.can('MANAGE_ROLES', bot))) return this.errorReply(`This bot needs the Manage Roles permission to use this command.`);

		// Validate @role exists
		const role = await this.getRole(this.target, true); // TODO ask about using names for role gets
		if (!role) return this.errorReply(`The role "${this.target}" was not found.`);

		// Validate @role is something user can assign
		await this.guild.members.fetch();
		let guildMember = this.guild.members.cache.get(this.author.id);
		if (!guildMember) throw new Error(`Cannot get guild member for user`);
		if (!(await this.canAssignRole(guildMember, role))) return this.errorReply(`You are not able to assign this role and cannot make it sticky as a result.`);

		// Validate @role is something the bot can assign
		guildMember = this.guild.members.cache.get(bot.id);
		if (!guildMember) throw new Error(`Cannot get guild member for bot`);
		if (!(await this.canAssignRole(guildMember, role))) return this.errorReply(`The bot is not able to assign this role and cannot make it sticky as a result.`);

		// Validate @role is not already sticky (database query)
		this.worker = await pgPool.connect();
		let res = await this.worker.query(`SELECT sticky FROM servers WHERE serverid = $1`, [this.guild.id]);
		if (!res.rows.length) throw new Error(`Unable to find sticky roles in database for guild: ${this.guild.name} (${this.guild.id})`);
		let stickyRoles: string[] = res.rows[0].sticky;

		if (stickyRoles.includes(role.id)) {
			this.releaseWorker();
			return this.errorReply(`That role is already sticky!`);
		}

		// ---VALIDATION LINE---
		// Make @role sticky (database update)
		stickyRoles.push(role.id);
		try {
			await this.worker.query('BEGIN');
			await this.worker.query(`UPDATE servers SET sticky = $1 WHERE serverid = $2`, [stickyRoles, this.guild.id]);
			// Find all users with @role and perform database update so role is now sticky for them
			await this.massStickyUpdate(role);
			await this.worker.query('COMMIT');
			this.releaseWorker();
		} catch(e) {
			await this.worker.query('ROLLBACK');
			this.releaseWorker();
			throw e;
		}
		// Return success message
		this.reply(`The role "${role.name}" is now sticky! Members who leave and rejoin the server with this role will have it reassigned automatically.`);
	}

	public static help(): string {
		return `${prefix}sticky @role - Makes @role sticky, meaning users assigned this role will not be able to have it removed by leaving the server.\n` +
			`Requires: Manage Roles Permissions\n` +
			`Aliases: None`;
	}

	public static async init(): Promise<void> {
		// This init is for all four sticky role commands
		const res = await pgPool.query('SELECT serverid, sticky FROM servers');
		if (!res.rows.length) return; // No servers?

		for (let i = 0; i < res.rows.length; i++) {
			const stickyRoles: string[] = res.rows[i].sticky;
			const guildID = res.rows[i].serverid;

			// Get list of users and their sticky roles
			const serverRes = await pgPool.query('SELECT userid, sticky FROM userlist WHERE serverid = $1', [guildID]);
			const server = client.guilds.cache.get(guildID);
			if (!server) {
				console.error('ERR NO SERVER FOUND');
				throw new Error(`Unable to find server when performing sticky roles startup. (${guildID})`);
			}
			await server.members.fetch();

			for (let j = 0; j < serverRes.rows.length; j++) {
				const member = server.members.cache.get(serverRes.rows[j].userid);
				if (!member) continue; // User left the server, but has not re-joined so we can't do anything but wait.
				// Check which of this member's roles are sticky
				const roles = [...member.roles.cache.values()].map(r => r.id).filter(r => stickyRoles.includes(r));

				// Compare member's current sticky roles to the ones in the database. If they match, do nothing.
				const userStickyRoles: string[] = serverRes.rows[j].sticky;
				if (!roles.length && userStickyRoles.length) {
					await pgPool.query('UPDATE userlist SET sticky = $1 WHERE serverid = $2 AND userid = $3', [roles, guildID, member.user.id]);
					continue;
				}

				if (roles.every(r => userStickyRoles.includes(r))) continue;

				// Update database with new roles
				await pgPool.query('UPDATE userlist SET sticky = $1 WHERE serverid = $2 AND userid = $3', [roles, guildID, member.user.id]);
			}
		}
	}
}

export class Unsticky extends StickyCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!toID(this.target)) return this.reply(Unsticky.help());
		if (!this.guild) return this.errorReply(`This command is not mean't to be used in PMs.`);
		if (!(await this.can('MANAGE_ROLES'))) return this.errorReply(`Access Denied`);

		// Validate @role exists
		const role = await this.getRole(this.target, true); // TODO ask about using names for role gets
		if (!role) return this.errorReply(`The role "${this.target}" was not found.`);

		// Validate @role is something user can assign
		await this.guild.members.fetch();
		let guildMember = this.guild.members.cache.get(this.author.id);
		if (!guildMember) throw new Error(`Cannot get guild member for user`);
		if (!(await this.canAssignRole(guildMember, role))) return this.errorReply(`You are not able to assign this role and cannot revoke it's sticky status as a result.`);

		// Validate @role is sticky (database query)
		this.worker = await pgPool.connect();
		let res = await this.worker.query(`SELECT sticky FROM servers WHERE serverid = $1`, [this.guild.id]);
		if (!res.rows.length) throw new Error(`Unable to find sticky roles in database for guild: ${this.guild.name} (${this.guild.id})`);
		let stickyRoles: string[] = res.rows[0].sticky;

		if (!stickyRoles.includes(role.id)) {
			this.releaseWorker();
			return this.errorReply(`That role is not sticky!`);
		}

		// ---VALIDATION LINE---
		// Make @role not sticky (database update)
		stickyRoles.splice(stickyRoles.indexOf(role.id), 1);
		try {
			await this.worker.query('BEGIN');
			await this.worker.query(`UPDATE servers SET sticky = $1 WHERE serverid = $2`, [stickyRoles, this.guild.id]);
			// Find all users with @role and perform database update so role is no longer sticky for them
			await this.massStickyUpdate(role, true);
			await this.worker.query('COMMIT');
			this.releaseWorker();
		} catch (e) {
			await this.worker.query('ROLLBACK');
			this.releaseWorker();
			throw e;
		}
		// Return success message
		this.reply(`The role "${role.name}" is no longer sticky.`);
	}

	public static help(): string {
		return `${prefix}unsticky @role - Makes it so @role is no longer sticky. Users will be able to remove @role from themselves by leaving the server.\n` +
			`Requires: Manage Roles Permissions\n` +
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
