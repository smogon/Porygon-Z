/**
 * dev.ts
 * Basic development related commands, may rename later.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';

export const aliases: IAliasList = {
	eval: ['js'],
};

export class Ping extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		this.reply(`Pong!`);
	}
}

export class Eval extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		if (!(await this.can('EVAL'))) return this.errorReply(`You do not have permission to do that.`);
		let result: any = '';
		try {
			// tslint:disable-next-line: no-eval - only owners can use
			result = await eval(this.target);
			if (result === '') result = '""';
		} catch (e) {
			result = `An error occured: ${e.toString()}`;
		}
		this.sendCode(result);
	}
}

export class Query extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		if (!(await this.can('EVAL'))) return this.errorReply(`You do not have permission to do that.`);
		pgPool.query(this.target, (err, res) => {
			if (err) {
				this.sendCode(`An error occured: ${err.toString()}`);
			} else {
				this.sendCode(this.formatResponse(res.rows));
			}
		});
	}

	private formatResponse(rows: any[]): string {
		let table = ``;

		// Add header
		for (let key in rows[0]) {
			table += key + ' ';
		}
		table += '\n';

		for (let row of rows) {
			for (let value of Object.values(row)) {
				table += value + ' ';
			}
			table += '\n';
		}

		if (table === '\n') table = 'No rows returned';
		return table;
	}
}
