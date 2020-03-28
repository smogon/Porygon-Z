/**
 * command_base.ts
 * This file contains the abstract super class all commands are based off of.
 * It contains various instance variables and methods that help with command
 * execution in general.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from './common';
import { PoolClient } from 'pg';
import { client } from './app';

export type DiscordChannel = Discord.TextChannel | Discord.DMChannel | Discord.NewsChannel;

/**
 * To add aliases for a command, add this object to your command file:

 * `export const aliases: aliases = {
 *	commandid: ['aliasid', 'aliasid', ...],
 * 	};`
 *
 * Replace commandid with the ID of the existing command you want to add aliases for,
 * and replace aliasid with the ID of the alias you want to add for that command.
*/
export interface IAliasList {
	[key: string]: string[];
}

export abstract class BaseCommand {
	protected message: Discord.Message;
	protected cmd: string;
	protected target: string;
	protected author: Discord.User;
	protected channel: DiscordChannel;
	protected guild: Discord.Guild | null;
	protected worker: PoolClient | null;
	protected isMonitor: boolean;
	protected allowPMs: boolean;

	/**
	 * All commands will need to call super(message) to work.
	 */
	protected constructor(message: Discord.Message) {
		this.message = message;
		const [cmd, ...target] = message.content.slice(prefix.length).split(' ');
		this.cmd = cmd;
		this.target = target.join(' ');
		this.author = message.author;
		this.channel = message.channel;
		this.guild = message.guild;
		this.worker = null;
		this.isMonitor = false;
		this.allowPMs = false;
	}

	/**
	 * Execute is the method called first when running a command.
	 */
	public abstract async execute(): Promise<void>;

	/**
	 * Can this command be used in PMs?
	 */
	public checkPmAllowed(): boolean {
		return this.allowPMs;
	}

	/**
	 * Checks if the user has permission to perform an action based on their discord permission flags.
	 *
	 * @param One of the the discord permission flags or supported custom flags. https://discord.js.org/#/docs/main/stable/class/Permissions?scrollTo=s-FLAGS 
	 * @param user Optional. The user to perform the permission check on. Defaults to the user using the command.
	 * @param guild Optional. The guild (server) to check the user's permissions in. Defaults to the guild the command was used in.
	 */
	protected async can(permission: string, user?: Discord.User, guild?: Discord.Guild): Promise<boolean> {
		const permissions = Object.keys(Discord.Permissions.FLAGS);
		const customPermissions = ['EVAL']; // Custom Permissions for Bot Owners
		if (!permissions.includes(permission) && !customPermissions.includes(permission)) throw new Error(`Unknown permission: ${permission}.`);

		if (!user) user = this.author;
		// Bot admins bypass all
		if ((process.env.ADMINS || '').split(',').map(toID).includes(toID(user.id))) return true;
		if (!guild) {
			if (!this.guild) return false; // Private Messages only support the EVAL permission check
			guild = this.guild;
		}

		// Handle custom permissions
		const member = await guild.members.fetch(user);

		switch (permission) {
		case 'EVAL':
			// Handled above, if we reach here you do not have permission
			return false;
			// Add more later, default case not needed
		}

		// All custom permissions need to resolve above.
		if (!permissions.includes(permission)) throw new Error(`Unhandled custom permission: ${permission}.`);
		return member.hasPermission((permission as Discord.PermissionResolvable), {checkAdmin: true, checkOwner: true});
	}

	/**
	 * Find a user by their name and discriminator.
	 * @param name Discord username (before the #)
	 * @param disriminator Discord discriminator (four numbers after the #)
	 */
	protected findUser(name: string, disriminator: string): Discord.User | undefined {
		let result = client.users.cache.find(u => {
			return u.username === name && u.discriminator === disriminator;
		});
		if (result) return result;
	}

	/**
	 * Get a user the bot can find
	 * @param id Discord userid
	 */
	protected getUser(id: string): Discord.User | undefined {
		return client.users.cache.get(id);
	}

	/**
	 * Get a channel the bot can access
	 * @param id Discord channelid
	 */
	protected getChannel(id: string): DiscordChannel | undefined {
		let channel = client.channels.cache.get(id);
		if (!channel) return;
		if (['text', 'dm', 'news'].includes(channel.type)) return (channel as DiscordChannel);
	}

	/**
	 * Inserts a user into the postgres database
	 * @param id Discord userid
	 */
	protected async insertUser(id: string): Promise<boolean> {
		let user = this.getUser(id);
		if (!user) return false;
		let userid = user.id; // To appease typescript in the upcoming map

		// can only insert if user is in the guild the command was used in
		if (!this.guild) return false;
		let inGuild = !!this.guild.members.cache.find(m => m.user.id === userid);
		if (!inGuild) return false;

		let worker = await pgPool.connect();
		try {
			await worker.query('BEGIN');

			let res = await worker.query('SELECT userid FROM users WHERE userid = $1', [id]);
			if (!res.rows.length) {
				await worker.query('INSERT INTO users (userid, name, discriminator) VALUES ($1, $2, $3)', [id, user.username, user.discriminator]);
			}

			res = await worker.query('SELECT userid FROM userlist WHERE serverid = $1 AND userid = $2', [this.guild.id, user.id]);
			if (!res.rows.length) {
				await worker.query('INSERT INTO userlist (serverid, userid) VALUES ($1, $2)', [this.guild.id, user.id]);
			}

			await worker.query('COMMIT');
			worker.release();
			return true;
		} catch (e) {
			await worker.query('ROLLBACK');
			worker.release();
			throw e;
		}
	}

	protected async insertChannel(id: string): Promise<boolean> {
		let channel = this.getChannel(id);
		if (!channel || channel.type !== 'text') return false;
		channel = (channel as Discord.TextChannel);
		let channelid = channel.id; // To appease typescript in the upcoming map statement

		// can only insert if channel is in the same guild as the command
		if (!this.guild) return false;
		let inGuild = this.guild.channels.cache.find(c => c.id === channelid);
		if (!inGuild) return false;

		let worker = await pgPool.connect();
		try {
			worker.query('BEGIN');

			// check if channel exists already
			let res = await worker.query('SELECT * FROM channels WHERE channelid = $1', [channel.id]);
			if (!res.rows.length) {
				await worker.query('INSERT INTO channels (channelid, channelname, serverid) VALUES ($1, $2, $3)', [channel.id, channel.name, this.guild.id]);
			}

			await worker.query('COMMIT');
			worker.release();
			return true;
		} catch (e) {
			await worker.query('ROLLBACK');
			worker.release();
			throw e;
		}
	}

	/**
	 * Reply to the message that triggered this command.
	 * @param msg The message to reply with
	 * @param channel The channel to reply in, defaults to the channel the command was used in
	 */
	protected reply(msg: string, channel?: DiscordChannel): void {
		if (!channel) channel = this.message.channel;
		channel.send(msg);
	}

	/**
	 * Like reply but appends :x: to the message to indicate an error or other problem.
	 * @param msg The message to reply with
	 * @param channel The channel to reply in, defaults to the channel the command was used in
	 */
	protected errorReply(msg: string, channel?: DiscordChannel): void {
		if (!channel) channel = this.message.channel;
		channel.send('\u274C ' + msg);
	}

	/**
	 * Send a reply in a code block
	 * @param msg The message to reply with
	 * @param language The programming language to use for syntax highlighting, defaults to an empty string (none)
	 * @param channel The channel to reply in, defaults to the channel the command was used in.
	 */
	protected sendCode(msg: string, language?: string, channel?: DiscordChannel): void {
		if (!channel) channel = this.message.channel;
		channel.send(`\`\`\`${language || ''}\n${msg}\n\`\`\``);
	}

	/**
	 * Used by app.ts to release a PoolClient in the event
	 * a command using one crashes
	 */
	public releaseWorker(): void {
		if (this.worker) {
			this.worker.release();
			this.worker = null;
		}
	}
}

/**
 * The BaseMonitor class is the Super Class for all chat monitors.
 * It extends BaseCommand and simply adds a required shouldExecute
 * method that is run before execute is, and stops execute from
 * running if it returns false.
 */
export abstract class BaseMonitor extends BaseCommand {
	protected constructor(message: Discord.Message, monitorName: string) {
		super(message);
		this.cmd = monitorName;
		this.target = this.message.content;
		this.isMonitor = true;
	}

	public abstract async shouldExecute(): Promise<boolean>;
}
