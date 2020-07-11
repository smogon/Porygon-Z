/**
 * command_base.ts
 * This file contains the abstract super class all commands are based off of.
 * It contains various instance variables and methods that help with command
 * execution in general.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from './common';
import { PoolClient } from 'pg';
import { client, verifyData } from './app';

export type DiscordChannel = Discord.TextChannel | Discord.NewsChannel;

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

	/**
	 * All commands will need to call super(message) to work.
	 */
	protected constructor(message: Discord.Message) {
		this.message = message;
		const [cmd, ...target] = message.content.slice(prefix.length).split(' ');
		this.cmd = cmd;
		this.target = target.join(' ');
		this.author = message.author;
		this.channel = (message.channel as DiscordChannel);
		this.guild = message.guild;
		this.worker = null;
		this.isMonitor = false;
	}

	/**
	 * Execute is the method called first when running a command.
	 */
	public abstract async execute(): Promise<Discord.Message | void>;

	/**
	 * Help provides a help string containing information on the command
	 * in question that can be pulled by the help command and can also
	 * be used when the command in question is incorrectly used.
	 *
	 * It is static so it can be used without construction.
	 */
	public static help(): string {
		return `No help is avaliable for this command.`;
	};

	/**
	 * Checks if the user has permission to perform an action based on their discord permission flags.
	 *
	 * @param permission One of the the discord permission flags or supported custom flags. https://discord.js.org/#/docs/main/stable/class/Permissions?scrollTo=s-FLAGS
	 * @param user Optional. The user to perform the permission check for. Defaults to the user using the command.
	 * @param guild Optional. The guild (server) to check the user's permissions in. Defaults to the guild the command was used in.
	 */
	protected async can(permission: string, user?: Discord.User, guild?: Discord.Guild): Promise<boolean> {
		if (!user) user = this.author;
		if (!guild && this.guild) guild = this.guild;
		const permissions = Object.keys(Discord.Permissions.FLAGS);
		const customPermissions = ['EVAL']; // Custom Permissions for Bot Owners
		if (!permissions.includes(permission) && !customPermissions.includes(permission)) throw new Error(`Unknown permission: ${permission}.`);
		// Bot admins bypass all
		if ((process.env.ADMINS || '').split(',').map(toID).includes(toID(user.id))) return true;
		if (!guild) return false; // In PMs, all actions return false unless you are a bot admin

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
	 * Parse a string into a channel
	 * @param rawChannel - A channelid, or channel mention
	 * @param inServer - If the channel must be the in server the command was used in.
	 * @param authorVisibilitity - If the author of the command must be able to see the channel to fetch it.
	 * @param allowName - If this is true, the method will attempt to get the channel via matching its name. This can be risky since channels can share names.
	 */
	protected getChannel(rawChannel: string, inServer: boolean = true, authorVisibilitity: boolean = true, allowName: boolean = false): DiscordChannel | void {
		if (!toID(rawChannel)) return; // No information

		let channelid = '';
		if (/<#\d{18}>/.test(rawChannel)) {
			rawChannel = rawChannel.trim();
			channelid = rawChannel.substring(2, rawChannel.length - 1);
		} else if (this.guild && allowName) {
			for (let [k, v] of this.guild.channels.cache) {
				if (toID(v.name) === toID(rawChannel) && ['news', 'text'].includes(v.type)) {
					// Validation of visibility handled below
					channelid = k;
					break;
				}
			}
		}
		if (!channelid) channelid = rawChannel;

		let channel = (client.channels.cache.get(channelid) as DiscordChannel); // Validation for this type occurs below
		if (!channel) return;
		if (!['text', 'news'].includes(channel.type)) return;
		if (inServer) {
			if (!this.guild) return;
			if (channel.guild && channel.guild.id !== this.guild.id) return;
		}
		if (authorVisibilitity) {
			let guildMember = channel.guild.member(this.author.id);
			if (!guildMember) return; // User not in guild and cannot see channel
			let permissions = channel.permissionsFor(guildMember);
			if (!permissions) throw new Error(`Unable to get channel permissions for user. Channel: ${channel.id}, User: ${guildMember.id}`); // Should never happen since we are using a GuildMember
			if (!permissions.has('VIEW_CHANNEL')) return;
		}
		return (channel as DiscordChannel);
	}

	/**
	 * Parse a string into a user
	 * @param rawUser - A userid, mention, or username#disriminator combination.
	 */
	protected getUser(rawUser: string): Discord.User | void {
		if (!toID(rawUser)) return; // No information.
		rawUser = rawUser.trim();
		let userid: string | undefined;

		if (/<@!?\d{18}>/.test(rawUser)) {
			// Mention
			let startingIndex = rawUser.includes('!') ? 3 : 2;
			userid = rawUser.substring(startingIndex, rawUser.length - 1);
		} else if (/[^@#:]{1,32}#\d{4}/.test(rawUser)) {
			// try to extract from a username + discriminator (eg: Name#1111)
			userid = this.findUser(rawUser.split('#')[0], rawUser.split('#')[1]);
		}
		if (!userid) {
			userid = rawUser;
		}

		return client.users.cache.get(userid);
	}

	/**
	 * Find a user by their name and discriminator.
	 * @param name Discord username (before the #)
	 * @param disriminator Discord discriminator (four numbers after the #)
	 */
	private findUser(name: string, disriminator: string): string | undefined {
		let result = client.users.cache.find(u => {
			return u.username === name && u.discriminator === disriminator;
		});
		if (result) return result.id;
	}

	/**
	 * Get a server the bot can access
	 * Mostly serves as a wrapper for commands that cannot access the discord client
	 * @param server - The server name or id to get
	 * @param inServer - If this is true, the author of the command must be in the server to get it
	 * @param allowName - If this is true, this method will attempt to get the server by its name. This can be risky since servers can share names.
	 */
	protected async getServer(rawServer: string, inServer: boolean = true, allowName: boolean = false): Promise<Discord.Guild | undefined> {
		if (!toID(rawServer)) return;
		rawServer = rawServer.trim();

		if (!/\d{16}/.test(rawServer) && allowName) {
			// Server name
			for (let [k, v] of client.guilds.cache) {
				if (toID(v.name) === toID(rawServer)) {
					rawServer = k;
					break;
				}
			}
		}

		const server = client.guilds.cache.get(rawServer);
		if (!server) return;

		if (inServer) {
			await server.members.fetch();
			if (!server.members.cache.has(this.author.id)) return;
		}

		return server;
	}

	protected verifyData = verifyData;

	/**
	 * Reply to the message that triggered this command.
	 * @param msg The message to reply with
	 * @param channel The channel to reply in, defaults to the channel the command was used in
	 */
	protected reply(msg: string, channel?: DiscordChannel): Promise<Discord.Message> | void {
		if (!msg) return;
		if (!channel) channel = this.channel;
		return channel.send(msg);
	}

	/**
	 * Like reply but appends :x: to the message to indicate an error or other problem.
	 * @param msg The message to reply with
	 * @param channel The channel to reply in, defaults to the channel the command was used in
	 */
	protected errorReply(msg: string, channel?: DiscordChannel): Promise<Discord.Message> | void {
		if (!msg) return;
		if (!channel) channel = this.channel;
		return channel.send('\u274C ' + msg);
	}

	/**
	 * Send a reply in a code block
	 * @param msg The message to reply with
	 * @param language The programming language to use for syntax highlighting, defaults to an empty string (none)
	 * @param channel The channel to reply in, defaults to the channel the command was used in.
	 */
	protected sendCode(msg: string, language?: string, channel?: DiscordChannel): Promise<Discord.Message> | void {
		if (msg === '') return;
		if (!channel) channel = this.channel;
		return channel.send(`\`\`\`${language || ''}\n${msg}\n\`\`\``);
	}

	/**
	 * Send a message to the server's log channel.
	 * If one is not setup, the message is dropped.
	 * @param msg The message to send
	 */
	protected async sendLog(msg: string | Discord.MessageEmbed): Promise<Discord.Message | void> {
		if (!toID(msg) || !this.guild) return;
		const channel = this.getChannel((await pgPool.query(`SELECT logchannel FROM servers WHERE serverid = $1`, [this.guild.id])).rows[0].logchannel, false, false);
		if (!channel) return;
		channel.send(msg);
	}

	/**
	 * Used by app.ts to release a PoolClient in the event
	 * a command using one crashes
	 */
	public releaseWorker(warn: boolean = false): void {
		if (this.worker) {
			if (warn) console.warn(`Releasing PG worker for ${this.isMonitor ? 'monitor' : 'command'}: ${this.cmd}`);
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

/**
 * The ReactionPageTurner class allows you to create a message
 * with a set of emoji underneath allowing the user to navigate
 * through a set of pages.
 */
export abstract class ReactionPageTurner {
	protected message: Discord.Message | null;
	protected collector: Discord.ReactionCollector | null;
	protected targetReactions: string[];
	protected user: Discord.User;
	protected page: number;
	protected abstract lastPage: number;
	protected options: Discord.ReactionCollectorOptions;
	protected constructor(messageOrChannel: Discord.Message | DiscordChannel, user: Discord.User, options?: Discord.ReactionCollectorOptions) {
		if (!options) {
			options = {idle: 1000 * 60 * 5};
		}

		this.message = null;
		this.collector = null;
		this.options = options;
		this.user = user;
		// ['⏮️', '◀️', '▶️', '⏭️']
		this.targetReactions = ['\u{23EE}\u{FE0F}', '\u{25C0}\u{FE0F}', '\u{25B6}\u{FE0F}', '\u{23ED}\u{FE0F}'];
		this.page = 1;
	}

	/**
	 * Initalize should be called at the end of the concrete class's contructor.
	 * It's job is to finish some async work such as sending the initial message
	 * that cannot be done in the constructor.
	 * @param messageOrChannel
	 * @param options
	 */
	protected async initalize(messageOrChannel: Discord.Message | DiscordChannel): Promise<void> {
		if (this.message) throw new Error(`Reaction Page Turner already initalized.`);
		if (!(messageOrChannel instanceof Discord.Message)) {
			this.message = await messageOrChannel.send(this.buildPage());
		} else {
			this.message = messageOrChannel;
		}

		const filter: Discord.CollectorFilter = (reaction, user) => this.targetReactions.includes(reaction.emoji.name) && this.user.id === user.id;
		this.collector = new Discord.ReactionCollector(this.message, filter, this.options);

		this.collector.on('collect', this.collect.bind(this));
		this.collector.on('end', this.end.bind(this));

		this.initalizeReactions();
	}

	private initalizeReactions(): void {
		if (!this.message) throw new Error(`Message not initalized in page turner reactor.`);
		for (let react of this.targetReactions) {
			this.message.react(react);
		}
	}

	/**
	 * This method builds each page of the page turner.
	 */
	protected abstract buildPage(): Discord.MessageEmbed;

	/**
	 * Important note: Be sure to filter out reactions from the bot itself.
	 */
	protected async collect(reaction: Discord.MessageReaction, user: Discord.User): Promise<void> {
		if (!this.message) throw new Error(`Message not initalized in page turner reactor.`);
		await reaction.users.fetch();
		try {
			// Try to remove the user's reaction, don't throw if theres an error.
			reaction.users.remove(this.user);
		} catch (e) {}

		switch (reaction.emoji.name) {
		case '\u{23EE}\u{FE0F}':
			if (this.page === 1) return;
			this.page = 1;
			break;
		case '\u{25C0}\u{FE0F}':
			if (this.page === 1) return;
			this.page--;
			break;
		case '\u{25B6}\u{FE0F}':
			if (this.page === this.lastPage) return;
			this.page++;
			break;
		case '\u{23ED}\u{FE0F}':
			if (this.page === this.lastPage) return;
			this.page = this.lastPage;
			break;
		default:
			throw new Error(`Unexpected reaction on page turner: ${reaction.emoji.name}`);
		}

		await this.message.edit(this.buildPage());
	}

	protected end(collected: Discord.Collection<string, Discord.MessageReaction>, reason: string): void {
		if (!this.message) throw new Error(`Message not initalized in page turner reactor.`);
		// Exists for overwrite options
	}
}
