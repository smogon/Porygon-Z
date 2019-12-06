/**
 * dev.ts
 * Basic development related commands, may rename later.
 */
import Discord = require('discord.js');
import { ID, prefix, toID } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';

export const aliases: IAliasList = {
	eval: ['js'],
};

export class Ping extends BaseCommand {
	constructor(message: Discord.Message) {
		super('ping', message);
	}

	public execute() {
		this.reply(`Pong!`);
	}
}

export class Eval extends BaseCommand {
	constructor(message: Discord.Message) {
		super('eval', message);
	}

	public async execute() {
		// TODO proper permissions system
		if (!this.can('EVAL')) return this.reply(`\u274C You do not have permission to do that.`);
		let result: any = '';
		try {
			// tslint:disable-next-line: no-eval - only owners can use
			result = await eval(this.target);
		} catch (e) {
			result = `An error occured: ${e.toString()}`;
		}
		this.sendCode(result);
	}
}
