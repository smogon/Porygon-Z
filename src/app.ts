/**
 *              Porygon-Z
 * The Bot for the Official Smogon Discord
 *      https://discord.gg/smogon
 * 
 * Main File - app.ts
 * This is file you start the bot with.
 */
import fs = require('fs');
import Discord = require('discord.js');
import { BaseCommand } from './command_base';

export type ID = '' | string & {__isID: true};

interface Constructable<T> {
	new(message: Discord.Message): T;
}

interface commandModule {
	[key: string]: Constructable<BaseCommand> | string[];
}

/**
 * toID - Turns anything into an ID (string with only lowercase alphanumeric characters)
 * @param {any} text
 */
export function toID(text: any): ID {
	if (text && text.id) text = text.id;
	if (typeof text !== 'string' && typeof text !== 'number') return '';
	return ('' + text).toLowerCase().replace(/[^a-z0-9]+/g, '') as ID;
}

if (!require('dotenv').config().parsed) {
	console.log('Enviroment variables were not setup, create a .env file and add values for TOKEN.');
	process.exit(1);
}

const client = new Discord.Client();
// The prefix to all bot commands
export const prefix = '!';
// Map of Command Classes - Build before use
export const commands = new Discord.Collection<ID, Constructable<BaseCommand> | ID>();

// Load commands
const files = fs.readdirSync(`${__dirname}/commands`).filter(f => { return f.endsWith('.js'); });
for (let file of files) {
	const commandModule: commandModule = require(`${__dirname}/commands/${file}`);
	for (let cmd in commandModule) {
		let mod = commandModule[cmd];
		if (typeof mod === 'function') {
			// Its a command (class)
			commands.set(toID(cmd), mod);
		} else {
			// Its an alias object
			for (let key in mod) {
				let aliases = mod[key];
				for (let i = 0; i < aliases.length; i++) {
					commands.set(toID(aliases[i]), toID(key));
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
