/**
 * command_base.ts
 * This file contains the abstract super class all commands are based off of.
 * It contains various instance variables and methods that help with command
 * execution in general.
 */
import Discord = require('discord.js');
import { ID, prefix, toID } from './common';

export type DiscordChannel = Discord.TextChannel | Discord.DMChannel | Discord.GroupDMChannel;

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
	protected name: string;
	protected message: Discord.Message;
	protected cmd: string;
	protected target: string;
	protected author: Discord.User;
	protected channel: DiscordChannel;
	protected guild: Discord.Guild;

	/**
	 * All commands will need to call super('command name', message) to work.
	 */
	protected constructor(name: string, message: Discord.Message) {
		this.name = name;
		this.message = message;
		const [cmd, ...target] = message.content.slice(prefix.length).split(' ');
		this.cmd = cmd;
		this.target = target.join(' ');
		this.author = message.author;
		this.channel = message.channel;
		this.guild = message.guild;
	}

	/**
	 * Execute is the method called first when running a command.
	 */
	public abstract execute(): void;

	/**
	 * Checks if the user has permission to perform an action based on their discord permission flags.
	 *
	 * @param One of the the discord permission flags or supported custom flags. https://discord.js.org/#/docs/main/stable/class/Permissions?scrollTo=s-FLAGS 
	 * @param user Optional. The user to perform the permission check on. Defaults to the user using the command.
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
		const member = await guild.fetchMember(user);

		switch (permission) {
		case 'EVAL':
			// Handled above, if we reach here you do not have permission
			return false;
			// Add more later, default case not needed
		}

		// All custom permissions need to resolve above.
		if (!permissions.includes(permission)) throw new Error(`Unhandled custom permission: ${permission}.`);
		return member.hasPermission((permission as Discord.PermissionResolvable), undefined, true, true);
	}

	protected reply(msg: string, channel?: DiscordChannel): void {
		if (!channel) channel = this.message.channel;
		channel.send(msg);
	}

	protected sendCode(msg: string, language?: string, channel?: DiscordChannel): void {
		if (!channel) channel = this.message.channel;
		channel.send(`\`\`\`${language || ''}\n${msg}\n\`\`\``);
	}
}
