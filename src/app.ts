/**
 *              Porygon-Z
 * The Bot for the Official Smogon Discord
 *      https://discord.gg/smogon
 *
 * Main File - app.ts
 * This is file you start the bot with.
 */
import Discord = require('discord.js');
import fs = require('fs');

import { prefix, ID, toID, pgPool } from './common';
import { BaseCommand } from './command_base';

interface Constructable<T> {
	new(message: Discord.Message): T;
}

interface ICommandModule {
	[key: string]: Constructable<BaseCommand> | string[];
}

// Ensure database properly setup
require('./create-tables');

const client = new Discord.Client();
// Map of Command Classes - Build before use
export const commands = new Discord.Collection<ID, Constructable<BaseCommand> | ID>();

// Load commands
const files = fs.readdirSync(`${__dirname}/commands`).filter(f => f.endsWith('.js'));
for (const file of files) {
	// tslint:disable-next-line: no-var-requires
	const commandModule: ICommandModule = require(`${__dirname}/commands/${file}`);
	for (const cmd in commandModule) {
		const mod = commandModule[cmd];
		if (typeof mod === 'function') {
			// Its a command (class)
			commands.set(toID(cmd), mod);
		} else {
			// Its an alias object
			for (const key in mod) {
				const aliases = mod[key];
				for (const alias of aliases) {
					commands.set(toID(alias), toID(key));
				}
			}
		}
	}
}

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}.`);
});

// Fires when we get a new message from discord. We ignore messages that aren't commands or are from a bot.
client.on('message', msg => {
	if (msg.author.bot || !msg.content.startsWith(prefix)) return;
	// Attempt to run the request command if it exists.
	const cmdID = toID(msg.content.slice(prefix.length).split(' ')[0]);
	let command = commands.get(cmdID);
	if (typeof command === 'string') command = commands.get(command);
	// Throw if its another alias
	if (typeof command === 'string') throw new Error(`Alias "${cmdID}" did not point to command.`);
	if (!command || typeof command === 'string') return;

	// 100% not an alias, so it must be a command class.
	try {
		new (command as Constructable<BaseCommand>)(msg).execute();
	} catch (e) {
		console.error(`A command crashed:`);
		console.error(e);
		msg.channel.send(`\u274C - An error occured while trying to run your command. The error has been logged, and we will fix it soon.`);
	}
});

// Setup crash handlers
process.on('uncaughtException', err => {
	console.error(err);
});
process.on('unhandledRejection', err => {
	console.error(err);
});

// Login
client.login(process.env.TOKEN);
