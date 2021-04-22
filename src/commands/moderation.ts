/**
 * moderation.ts
 * Commands useful for server moderators
 * and administrators.
 */
import Discord = require('discord.js');
import {prefix, toID, database} from '../common';
import {BaseCommand} from '../command_base';
import {client} from '../app';

export class Whois extends BaseCommand {
	private readonly KEY_PERMISSIONS: {[key: string]: string};
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
		const orderedList = guild.members.cache
			.array()
			.sort((a, b) => (a.joinedTimestamp || Date.now()) - (b.joinedTimestamp || Date.now()));

		return `${orderedList.indexOf(user) + 1} of ${orderedList.length}`;
	}

	async execute() {
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied.');

		const user = this.getUser(this.target);
		if (!user) return this.errorReply(`The user "${this.target}" was not found.`);
		const guildUser = await this.guild.members.fetch(user.id);

		const embed: Discord.MessageEmbedOptions = {
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
					value: guildUser.permissions
						.toArray()
						.filter(p => (p in this.KEY_PERMISSIONS))
						.map(p => this.KEY_PERMISSIONS[p]).join(', ') || 'None',
				},
			],
			timestamp: Date.now(),
			footer: {
				text: `User ID: ${user.id}`,
			},
		};

		await this.channel.send({embed: embed});
	}

	static help(): string {
		return `${prefix}whois @user - Get detailed information on the selected user.\n` +
			'Requires: Kick Members Permissions\n' +
			'Aliases: None';
	}
}

export class WhoHas extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('KICK_MEMBERS'))) return this.errorReply('Access Denied.');

		if (!this.target.trim()) return this.reply(WhoHas.help());

		const role = await this.getRole(this.target, true);
		if (!role) return this.errorReply(`The role "${this.target}" was not found. Role names are case sensitive: make sure you're typing the role name exactly as it appears.`);

		const embed: Discord.MessageEmbedOptions = {
			color: 0x6194fd,
			description: `Members with the role ${role.name}.`,
			author: {
				name: role.name,
			},
			fields: [
				{
					name: 'Users',
					value: role.members.map(m => `<@${m.id}>`).join(', ') || 'No users have this role',
				},
			],
			timestamp: Date.now(),
			footer: {
				text: `Role ID: ${role.id}`,
			},
		};

		void this.channel.send({embed: embed});
	}

	static help(): string {
		return `${prefix}whohas [role] - Get a list of all users with a given role. If there are multiple roles with the same please use a roleid as the argument.\n` +
		'When using the role name as an argument it\n' +
		'Requires: Kick Members Permissions\n' +
		'Aliases: None';
	}
}

/**
 * Sticky Roles
 */

abstract class StickyCommand extends BaseCommand {
	async canAssignRole(user: Discord.GuildMember, role: Discord.Role): Promise<boolean> {
		if (!this.guild || user.guild.id !== this.guild.id || role.guild.id !== this.guild.id) {
			throw new Error('Guild mismatch in sticky command');
		}
		// This method does NOT perform a manage roles permission check.
		// It simply checks if a user would be able to assign the role provided
		// assuming they have permissions to assign roles.

		// Bot owner override
		if (await this.can('EVAL', user.user)) return true;

		// Server owner override
		if (this.guild.ownerID === user.user.id) return true;

		await this.guild.roles.fetch();
		const highestRole = [...user.roles.cache.values()].sort((a, b) => b.comparePositionTo(a))[0];
		if (role.comparePositionTo(highestRole) >= 0) return false;
		return true;
	}

	async massStickyUpdate(role: Discord.Role, unsticky = false): Promise<void> {
		if (!this.guild || this.guild.id !== role.guild.id) throw new Error('Guild missmatch in sticky command');
		if (!role.members.size) return; // No members have this role, so no database update needed

		await this.guild.members.fetch();
		let query = `UPDATE userlist SET sticky = ${unsticky ? 'array_remove' : 'array_append'}(sticky, $1) WHERE serverid = $2 AND userid IN (`;
		let argInt = 3;
		const args = [role.id, role.guild.id];
		for (const [, member] of role.members) {
			await this.verifyData({author: member.user, guild: this.guild});
			query += `$${argInt}, `;
			args.push(member.user.id);
			argInt++;
		}
		query = query.slice(0, query.length - 2);
		query += ');';

		await database.query(query, args);
	}
}

export class Sticky extends StickyCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!toID(this.target)) return this.reply(Sticky.help());
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('MANAGE_ROLES'))) return this.errorReply('Access Denied');
		const bot = this.guild.me ? this.guild.me.user : null;
		if (!bot) throw new Error('Bot user not found.');
		if (!(await this.can('MANAGE_ROLES', bot))) {
			return this.errorReply('This bot needs the Manage Roles permission to use this command.');
		}

		// Validate @role exists
		const role = await this.getRole(this.target, true); // TODO ask about using names for role gets
		if (!role) return this.errorReply(`The role "${this.target}" was not found.`);

		// Validate @role is something user can assign
		await this.guild.members.fetch();
		let guildMember = this.guild.members.cache.get(this.author.id);
		if (!guildMember) throw new Error('Cannot get guild member for user');
		if (!(await this.canAssignRole(guildMember, role))) {
			return this.errorReply('You are not able to assign this role and cannot make it sticky as a result.');
		}

		// Validate @role is something the bot can assign
		guildMember = this.guild.members.cache.get(bot.id);
		if (!guildMember) throw new Error('Cannot get guild member for bot');
		if (!(await this.canAssignRole(guildMember, role))) {
			return this.errorReply('The bot is not able to assign this role and cannot make it sticky as a result.');
		}

		// Validate @role is not already sticky (database query)
		const res = await database.queryWithResults('SELECT sticky FROM servers WHERE serverid = $1', [this.guild.id]);
		if (!res.length) {
			throw new Error(`Unable to find sticky roles in database for guild: ${this.guild.name} (${this.guild.id})`);
		}
		const stickyRoles: string[] = res[0].sticky;

		if (stickyRoles.includes(role.id)) {
			return this.errorReply('That role is already sticky!');
		}

		// ---VALIDATION LINE---
		// Make @role sticky (database update)
		stickyRoles.push(role.id);
		await database.withinTransaction([
			{statement: 'UPDATE servers SET sticky = $1 WHERE serverid = $2', args: [stickyRoles, this.guild.id]},
		]);
		await this.massStickyUpdate(role); // I hope this works...
		await this.reply(`The role "${role.name}" is now sticky! Members who leave and rejoin the server with this role will have it reassigned automatically.`);
	}

	static help(): string {
		return `${prefix}sticky @role - Makes @role sticky, meaning users assigned this role will not be able to have it removed by leaving the server.\n` +
			'Requires: Manage Roles Permissions\n' +
			'Aliases: None';
	}

	static async init(): Promise<void> {
		// This init is for all four sticky role commands
		const res = await database.queryWithResults('SELECT serverid, sticky FROM servers');
		if (!res.length) return; // No servers?

		for (const {sticky: stickyRoles, serverid} of res) {
			// Get list of users and their sticky roles
			const serverRes = await database.queryWithResults('SELECT userid, sticky FROM userlist WHERE serverid = $1', [serverid]);
			const server = client.guilds.cache.get(serverid);
			if (!server) {
				console.error('ERR NO SERVER FOUND');
				throw new Error(`Unable to find server when performing sticky roles startup. (${serverid})`);
			}
			await server.members.fetch();

			for (const {userid, sticky} of serverRes) {
				const member = server.members.cache.get(userid);
				if (!member) continue; // User left the server, but has not re-joined so we can't do anything but wait.
				// Check which of this member's roles are sticky
				const roles = [...member.roles.cache.values()].map(r => r.id).filter(r => stickyRoles.includes(r));

				// Compare member's current sticky roles to the ones in the database. If they match, do nothing.
				const userStickyRoles: string[] = sticky;
				if (!roles.length && userStickyRoles.length) {
					await database.query(
						'UPDATE userlist SET sticky = $1 WHERE serverid = $2 AND userid = $3',
						[roles, serverid, member.user.id]
					);
					continue;
				}

				if (roles.every(r => userStickyRoles.includes(r))) continue;

				// Update database with new roles
				await database.queryWithResults(
					'UPDATE userlist SET sticky = $1 WHERE serverid = $2 AND userid = $3',
					[roles, serverid, member.user.id]
				);
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
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('MANAGE_ROLES'))) return this.errorReply('Access Denied');

		// Validate @role exists
		const role = await this.getRole(this.target, true); // TODO ask about using names for role gets
		if (!role) return this.errorReply(`The role "${this.target}" was not found.`);

		// Validate @role is something user can assign
		await this.guild.members.fetch();
		const guildMember = this.guild.members.cache.get(this.author.id);
		if (!guildMember) throw new Error('Cannot get guild member for user');
		if (!(await this.canAssignRole(guildMember, role))) {
			return this.errorReply('You are not able to assign this role and cannot revoke its sticky status as a result.');
		}

		// Validate @role is sticky (database query)
		const res = await database.queryWithResults('SELECT sticky FROM servers WHERE serverid = $1', [this.guild.id]);
		if (!res.length) {
			throw new Error(`Unable to find sticky roles in database for guild: ${this.guild.name} (${this.guild.id})`);
		}
		const stickyRoles: string[] = res[0].sticky;

		if (!stickyRoles.includes(role.id)) {
			return this.errorReply('That role is not sticky!');
		}

		// ---VALIDATION LINE---
		// Make @role not sticky (database update)
		stickyRoles.splice(stickyRoles.indexOf(role.id), 1);
		await database.withinTransaction([
			{statement: 'UPDATE servers SET sticky = $1 WHERE serverid = $2', args: [stickyRoles, this.guild.id]},
		]);
		await this.massStickyUpdate(role, true);

		// Return success message
		await this.reply(`The role "${role.name}" is no longer sticky.`);
	}

	static help(): string {
		return `${prefix}unsticky @role - Makes it so @role is no longer sticky. Users will be able to remove @role from themselves by leaving the server.\n` +
			'Requires: Manage Roles Permissions\n' +
			'Aliases: None';
	}
}

export class EnableLogs extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('MANAGE_GUILD'))) return this.errorReply('Access Denied');

		const res = await database.queryWithResults('SELECT logchannel FROM servers WHERE serverid = $1', [this.guild.id]);
		if (res[0].logchannel) {
			return this.errorReply(`This server is already set up to log to <#${res[0].logchannel}>.`);
		}

		await database.query('UPDATE servers SET logchannel = $1 WHERE serverid = $2', [this.channel.id, this.guild.id]);
		await this.reply('Server events will now be logged to this channel.');
	}

	static help(): string {
		return `${prefix}enablelogs - Log moderation actions to this channel.\n` +
			'Requires: Manage Server Permissions\n' +
			'Aliases: None';
	}
}

export class DisableLogs extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!this.guild) return this.errorReply('This command is not meant to be used in PMs.');
		if (!(await this.can('MANAGE_GUILD'))) return this.errorReply('Access Denied');

		const res = await database.queryWithResults('SELECT logchannel FROM servers WHERE serverid = $1', [this.guild.id]);
		if (!res[0].logchannel) return this.errorReply('This server is not setup to log messages to a log channel.');

		await database.query('UPDATE servers SET logchannel = $1 WHERE serverid = $2', [null, this.guild.id]);
		await this.reply('Server events will no longer be logged to this channel.');
	}

	static help(): string {
		return `${prefix}disablelogs - Stop logging moderation actions to this channel.\n` +
			'Requires: Manage Server Permissions\n' +
			'Aliases: None';
	}
}
