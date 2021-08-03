/**
 * dev.ts
 * Basic development related commands, may rename later.
 */
import Discord = require('discord.js');
import {shutdown} from '../app';
import {prefix, database} from '../common';
import {BaseCommand, IAliasList} from '../command_base';
import * as child_process from 'child_process';
let updateLock = false;

export const aliases: IAliasList = {
	eval: ['js'],
};

export class Ping extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		await this.reply('Pong!');
	}

	static help(): string {
		return `${prefix}ping - Pings the bot, used to check if the bot's command engine is working.\n` +
			'Aliases: None';
	}
}

export class Eval extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!(await this.can('EVAL'))) return this.errorReply('You do not have permission to do that.');
		let result: any = '';
		try {
			// Eval is (hopefully) secure here as we are permission-checked to owners.
			// eslint-disable-next-line no-eval
			result = await eval(this.target);
			if (result === '') result = '""';
		} catch (e) {
			result = `An error occured: ${e.toString()}`;
		}
		await this.sendCode(result);
	}
}

export class Query extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!(await this.can('EVAL'))) return this.errorReply('You do not have permission to do that.');

		try {
			const res = await database.queryWithResults(this.target, undefined);
			await this.sendCode(this.formatResponse(res));
		} catch (err) {
			await this.sendCode(`An error occured: ${err.toString()}`);
		}
	}

	private formatResponse(rows: any[]): string {
		let table = '';

		// Add header
		for (const key in rows[0]) {
			table += key + ' ';
		}
		table += '\n';

		for (const row of rows) {
			for (const value of Object.values(row)) {
				table += value + ' ';
			}
			table += '\n';
		}

		if (table === '\n') table = 'No rows returned';
		return table;
	}
}

export class Update extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!(await this.can('EVAL'))) return this.errorReply('You do not have permission to do that.');
		if (updateLock) return this.errorReply('Another update is already in progress.');
		updateLock = true;

		child_process.exec('git pull --rebase origin master', (error) => {
			updateLock = false;
			if (error) {
				void this.errorReply('An error occured while updating the bot: ');
				void this.sendCode(error.stack || 'No stack trace found.');
				return;
			}
			void this.reply('Update complete.');
			return;
		});
	}
}

export class Shutdown extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	async execute() {
		if (!(await this.can('EVAL'))) return this.errorReply('You do not have permission to do that.');
		if (updateLock) return this.errorReply('Wait for the update to finish.');
		shutdown();

		await this.reply('Shutting down...');

		// Incase the following never exists, kill in 10 seconds
		setTimeout(() => {
			console.log('Graceful shutdown took too long, killing');
			process.exit();
		}, 10000);

		// empty the pool of database workers
		await database.destroy();

		// exit
		process.exit();
	}
}
