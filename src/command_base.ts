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
	protected guild: Discord.Guild;
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
		this.guild = (message.guild as Discord.Guild);
		this.worker = null;
		this.isMonitor = false;
	}

	/**
	 * Execute is the method called first when running a command.
	 */
	public abstract async execute(): Promise<Discord.Message | void>;

	/**
	 * Checks if the user has permission to perform an action based on their discord permission flags.
	 *
	 * @param permission One of the the discord permission flags or supported custom flags. https://discord.js.org/#/docs/main/stable/class/Permissions?scrollTo=s-FLAGS
	 * @param user Optional. The user to perform the permission check for. Defaults to the user using the command.
	 * @param guild Optional. The guild (server) to check the user's permissions in. Defaults to the guild the command was used in.
	 */
	protected async can(permission: string, user?: Discord.User, guild?: Discord.Guild): Promise<boolean> {
		if (!user) user = this.author;
		if (!guild) guild = this.guild;
		const permissions = Object.keys(Discord.Permissions.FLAGS);
		const customPermissions = ['EVAL']; // Custom Permissions for Bot Owners
		if (!permissions.includes(permission) && !customPermissions.includes(permission)) throw new Error(`Unknown permission: ${permission}.`);
		// Bot admins bypass all
		if ((process.env.ADMINS || '').split(',').map(toID).includes(toID(user.id))) return true;

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
	 * TODO how do we handle channels in database that the bot cant access via discord?
	 */
	protected getChannel(rawChannel: string, inServer: boolean = false): DiscordChannel | void {
		if (!toID(rawChannel)) return; // No information

		let channelid = '';
		if (/<#\d{18}>/.test(rawChannel)) {
			rawChannel = rawChannel.trim();
			channelid = rawChannel.substring(2, rawChannel.length - 1);
		} else {
			channelid = rawChannel;
		}

		let channel = (client.channels.cache.get(channelid) as DiscordChannel); // Validation for this type occurs below
		if (!channel) return;
		if (!['text', 'news'].includes(channel.type)) return;
		if (inServer && channel.guild && channel.guild.id !== this.guild.id) return;
		// TODO If the requester cannot see the channel, it dosen't exist to them.
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
	 * @param id Discord guildid aka serverid
	 */
	protected getServer(id: string): Discord.Guild | undefined {
		return client.guilds.cache.get(id);
	}

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
			this.message = await messageOrChannel.send(this.buildPage(messageOrChannel.guild));
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
	 * @param guild Opional guild used only during initalization.
	 */
	protected abstract buildPage(guild?: Discord.Guild): Discord.MessageEmbed;

	/**
	 * Important note: Be sure to filter out reactions from the bot itself.
	 */
	protected async collect(reaction: Discord.MessageReaction, user: Discord.User): Promise<void> {
		if (!this.message) throw new Error(`Message not initalized in page turner reactor.`);
		await reaction.users.fetch();
		reaction.users.remove(this.user);

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
