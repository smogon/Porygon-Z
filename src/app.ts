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
import { BaseCommand, BaseMonitor } from './command_base';

interface Constructable<T> {
	new(message: Discord.Message): T;
}

interface ICommandModule {
	[key: string]: Constructable<BaseCommand> | string[];
}

interface IMonitorModule {
	[key: string]: Constructable<BaseMonitor>;
}

// Ensure database properly setup
require('./create-tables');

export const client = new Discord.Client();
// Map of Command Classes - Build before use
export const commands = new Discord.Collection<ID, Constructable<BaseCommand> | ID>();
// Map of Chat Monitors - Build before use
export const monitors = new Discord.Collection<ID, Constructable<BaseMonitor>>();

// Load commands
const commandFiles = fs.readdirSync(`${__dirname}/commands`).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
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

// Load Monitors
const monitorFiles = fs.readdirSync(`${__dirname}/monitors`).filter(f => f.endsWith('.js'));
for (const file of monitorFiles) {
	// tslint:disable-next-line: no-var-requires
	const monitorModule: IMonitorModule = require(`${__dirname}/monitors/${file}`);
	for (const monitor in monitorModule) {
		monitors.set(toID(monitor), monitorModule[monitor]);
	}
}

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}.`);
});

// Fires when we get a new message from discord. We ignore messages that aren't commands or are from a bot.
client.on('message', async msg => {
	if (msg.author.bot) return;
	if (!msg.content.startsWith(prefix)) {
		// Handle Chat Monitors
		for (let [k, v] of monitors) {
			const monitor = new (v as Constructable<BaseMonitor>)(msg);
			try {
				if (!(await monitor.shouldExecute())) continue;
				await monitor.execute();
			} catch (e) {
				// TODO improved crashlogger
				console.error(`A chat montior crashed:`);
				console.error(e);
			}
			// Release any workers regardless of the result
			monitor.releaseWorker();
		}
		return;
	}
	// Attempt to run the request command if it exists.
	const cmdID = toID(msg.content.slice(prefix.length).split(' ')[0]);
	let command = commands.get(cmdID);
	if (typeof command === 'string') command = commands.get(command);
	// Throw if its another alias
	if (typeof command === 'string') throw new Error(`Alias "${cmdID}" did not point to command.`);
	if (!command || typeof command === 'string') return;

	// 100% not an alias, so it must be a command class.
	const cmd = new (command as Constructable<BaseCommand>)(msg);
	try {
		await cmd.execute();
	} catch (e) {
		// TODO improved crashlogger
		console.error(`A command crashed:`);
		console.error(e);
		msg.channel.send(`\u274C - An error occured while trying to run your command. The error has been logged, and we will fix it soon.`);
	}
	// Release any workers regardless of the result
	cmd.releaseWorker();
});

client.on("guildCreate", async guild => {
	// Joined a guild, update the database if needed
	let res = await pgPool.query('SELECT serverid FROM servers WHERE serverid = $1', [guild.id]);
	if (!res.rows.length) {
		await pgPool.query('INSERT INTO servers (serverid, servername) VALUES ($1, $2)', [guild.id, guild.name]);
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
