/**
 * command_base.ts
 * This file contains the abstract super class all commands are based off of.
 * It contains various instance variables and methods that help with command
 * execution in general.
 */
import Discord = require('discord.js');
import { prefix, ID, toID } from './app';
export type DiscordChannel = Discord.TextChannel|Discord.DMChannel|Discord.GroupDMChannel;
export type aliasList = {[key: string]: string[]};

/* To add aliases for a command, add this object to your command file:

export const aliases: aliases = {
	commandid: ['aliasid', 'aliasid', ...],
};

Replace commandid with the ID of the existing command you want to add aliases for,
and replace aliasid with the ID of the alias you want to add for that command.
*/

export abstract class BaseCommand {
	name: string;
	message: Discord.Message;
	cmd: string;
	target: string;
	author: Discord.User;
	channel: DiscordChannel;
	guild: Discord.Guild;

	/**
	 * All commands will need to call super('command name', message) to work.
	 */
	constructor(name: string, message: Discord.Message) {
		this.name = name;
		this.message = message;
		let [cmd, ...target] = message.content.slice(prefix.length).split(' ');
		this.cmd = cmd;
		this.target = target.join(' ');
		this.author = message.author;
		this.channel = message.channel;
		this.guild = message.guild;
	}

	async can(permission: string, user?: Discord.User): Promise<boolean> {
		if (!user) user = this.author;
		let permissions = Object.keys(Discord.Permissions.FLAGS);
		permissions.push('EVAL'); // Custom Permissions for Bot Owners
		if (!permissions.includes(permission)) throw new Error(`Unknown permission: ${permission}.`);
		if ((process.env.ADMINS || '').split(',').map(toID).includes(toID(user.id))) return true;

		let member = await this.guild.fetchMember(user);
		return member.hasPermission((permission as Discord.PermissionResolvable), undefined, true, true);
	}

	reply(msg: string, channel?: DiscordChannel): void {
		if (!channel) channel = this.message.channel;
		channel.send(msg);
	}

	sendCode(msg: string, channel?: DiscordChannel, language?: string): void {
		if (!channel) channel = this.message.channel;
		channel.send(`\`\`\`${language || ''}\n${msg}\n\`\`\``);
	}

	/**
	 * Execute is the method called first when running a command.
	 */
	abstract execute(): void;
}
