/**
 * dev.ts
 * Basic development related commands, may rename later.
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList } from '../command_base';
import { QueryResult } from 'pg';

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
		if (!(await this.can('EVAL'))) return this.reply(`\u274C You do not have permission to do that.`);
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

export class Query extends BaseCommand {
	constructor(message: Discord.Message) {
		super('query', message);
	}

	public async execute() {
		if (!(await this.can('EVAL'))) return this.reply(`\u274C You do not have permission to do that.`);
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

		return table;
	}
}
