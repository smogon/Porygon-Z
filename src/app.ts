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
require('./database_version_control');

// Database cache sets
const users = new Set<string>();
const servers =  new Set<string>();
const channels = new Set<string>();
const userlist = new Set<string>();

async function verifyData(message: Discord.Message) {
	let worker = null;

	// Server
	if (message.guild && !servers.has(message.guild.id)) {
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM servers WHERE serverid = $1', [message.guild.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO servers (serverid, servername) VALUES ($1, $2)', [message.guild.id, message.guild.name]);
		}
		servers.add(message.guild.id);
	}

	// Channel
	if (message.guild && message.channel && ['text', 'news'].includes(message.channel.type) && !channels.has(message.channel.id)) {
		let channel = (message.channel as Discord.TextChannel | Discord.NewsChannel);
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM channels WHERE channelid = $1', [channel.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO channels (channelid, channelname, serverid) VALUES ($1, $2, $3)', [channel.id, channel.name, message.guild.id]);
		}
		channels.add(message.channel.id);
	}

	// User
	if (!users.has(message.author.id)) {
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM users WHERE userid = $1', [message.author.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO users (userid, name, discriminator) VALUES ($1, $2, $3)', [message.author.id, message.author.username, message.author.discriminator]);
		}
		users.add(message.author.id);
	}

	// Userlist
	if (message.guild && !userlist.has(message.guild.id + ',' + message.author.id)) {
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM userlist WHERE serverid = $1 AND userid = $2', [message.guild.id, message.author.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO userlist (serverid, userid) VALUES ($1, $2)', [message.guild.id, message.author.id]);
		}
		userlist.add(message.guild.id + ',' + message.author.id);
	}

	if (worker) worker.release();
}

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
	if (!client || !client.user) throw new Error(`Bot not logged in and ready event triggered.`); // Should never happen
	console.log(`Logged in as ${client.user.tag}.`);
});

// Fires when we get a new message from discord. We ignore messages that aren't commands or are from a bot.
client.on('message', async msg => {
	await verifyData(msg);
	if (msg.author.bot) return;
	if (!msg.content.startsWith(prefix)) {
		// Handle Chat Monitors
		if (!msg.guild) return; // Ignore PMs
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
	// Skip if this is a PM.
	if (!msg.guild) return msg.reply(`Commands cannot be used in private messages.`);

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

// Setup crash handlers
async function onError(err: Error | {} | null | undefined) {
	if (!err) return console.error(`Error with no details thrown.`);
	try {
		const reportChannel = await client.channels.fetch(`${process.env.ERRCHANNEL}`);
		if (!reportChannel) return;
		if (!['text', 'news'].includes(reportChannel.type)) return;
		let msg = `Error: ${err}`;
		if (err instanceof Error) msg += `\nat: ${err.stack}`;
		(reportChannel as Discord.TextChannel).send(msg);
	} catch (e) {}

	console.error(err);
}

process.on('uncaughtException', async err => onError);

process.on('unhandledRejection', async err => onError);

client.on('error', async err => onError);

// Login
client.login(process.env.TOKEN);
