/**
 * dev.ts
 * Basic development related commands, may rename later.
 */
import Discord = require('discord.js');
import { prefix, ID, toID } from '../app';
import { BaseCommand, aliasList, DiscordChannel } from '../command_base';

export const aliases: aliasList = {
	eval: ['js'],
};

export class Ping extends BaseCommand {
	constructor(message: Discord.Message) {
		super('ping', message);
	}

	execute() {
		this.reply(`Pong!`);
	}
}

export class Eval extends BaseCommand {
	constructor(message: Discord.Message) {
		super('eval', message);
	}

	async execute() {
		// TODO proper permissions system
		if (!this.can('EVAL')) return this.reply(`\u274C You do not have permission to do that.`);
		let result: any = '';
		try {
			result = await eval(this.target);
		} catch (e) {
			result = `An error occured: ${e.toString()}`;
		}
		this.sendCode(result);
	}
}
