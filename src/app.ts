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
import { BaseCommand, BaseMonitor, DiscordChannel } from './command_base';

interface Constructable<T> {
	new(message: Discord.Message): T;
}

interface ICommandModule {
	[key: string]: Constructable<BaseCommand> | string[];
}

interface IMonitorModule {
	[key: string]: Constructable<BaseMonitor>;
}

interface IDatabaseInsert {
	author?: Discord.User; // Called author so its more compatible with Discord.Message
	guild?: Discord.Guild;
	channel?: DiscordChannel;
}

// Ensure database properly setup
require('./database_version_control');

// Shutdown helper
let lockdown = false;
export function shutdown() {
	lockdown = true;
}

// Database cache sets
const users = new Set<string>();
const servers =  new Set<string>();
const channels = new Set<string>();
const userlist = new Set<string>();

export async function verifyData(data: Discord.Message | IDatabaseInsert) {
	if (lockdown) return;
	let worker = null;

	// Server
	if (data.guild && !servers.has(data.guild.id)) {
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM servers WHERE serverid = $1', [data.guild.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO servers (serverid, servername, logchannel, sticky) VALUES ($1, $2, $3, $4)', [data.guild.id, data.guild.name, null, []]);
		}
		servers.add(data.guild.id);
	}

	// Channel
	if (data.guild && data.channel && ['text', 'news'].includes(data.channel.type) && !channels.has(data.channel.id)) {
		let channel = (data.channel as Discord.TextChannel | Discord.NewsChannel);
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM channels WHERE channelid = $1', [channel.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO channels (channelid, channelname, serverid) VALUES ($1, $2, $3)', [channel.id, channel.name, data.guild.id]);
		}
		channels.add(data.channel.id);
	}

	// User
	if (data.author && !users.has(data.author.id)) {
		if (!worker) worker = await pgPool.connect();
		let res = await worker.query('SELECT * FROM users WHERE userid = $1', [data.author.id]);
		if (!res.rows.length) {
			await worker.query('INSERT INTO users (userid, name, discriminator) VALUES ($1, $2, $3)', [data.author.id, data.author.username, data.author.discriminator]);
		}
		users.add(data.author.id);
	}

	// Userlist
	if (data.guild && data.author && !userlist.has(data.guild.id + ',' + data.author.id)) {
		// Validate they are both in the same server just in case
		await data.guild.members.fetch();
		const userInServer = data.guild.members.cache.has(data.author.id);
		if (userInServer) {
			if (!worker) worker = await pgPool.connect();
			let res = await worker.query('SELECT * FROM userlist WHERE serverid = $1 AND userid = $2', [data.guild.id, data.author.id]);
			if (!res.rows.length) {
				await worker.query('INSERT INTO userlist (serverid, userid, boosting, sticky) VALUES ($1, $2, $3, $4)', [data.guild.id, data.author.id, null, []]);
			}
			userlist.add(data.guild.id + ',' + data.author.id);
		}
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

// Load other client events
require('./events');

client.on('ready', () => {
	if (!client || !client.user) throw new Error(`Bot not logged in and ready event triggered.`); // Should never happen
	console.log(`Logged in as ${client.user.tag}.`);
});

// Fires when we get a new message from discord. We ignore messages that aren't commands or are from a bot.
client.on('message', async msg => {
	if (msg.webhookID) return;
	await verifyData(msg);
	if (msg.author.bot) return;
	if (!msg.content.startsWith(prefix)) {
		if (lockdown) return; // Ignore - bot restarting
		// Handle Chat Monitors
		if (!msg.guild) return; // Ignore PMs
		for (let [k, v] of monitors) {
			const monitor = new (v as Constructable<BaseMonitor>)(msg);
			try {
				if (await monitor.shouldExecute()) {
					await monitor.execute();
				}
			} catch (e) {
				onError(e, 'A chat monitor crashed: ');
			}
			// Release any workers regardless of the result
			monitor.releaseWorker(true);
		}
		return;
	}
	// Attempt to run the request command if it exists.
	// Skip if this is a PM.
	if (lockdown) return msg.reply(`The bot is restarting soon, please try again in a minute.`);

	const cmdID = toID(msg.content.slice(prefix.length).split(' ')[0]);
	let command = commands.get(cmdID);
	if (typeof command === 'string') command = commands.get(command);
	// Throw if its another alias
	if (typeof command === 'string') throw new Error(`Alias "${cmdID}" did not point to command.`);
	if (!command) return;

	// 100% not an alias, so it must be a command class.
	const cmd = new (command as Constructable<BaseCommand>)(msg);
	try {
		await cmd.execute();
	} catch (e) {
		onError(e, 'A chat command crashed: ');
		msg.channel.send(`\u274C - An error occured while trying to run your command. The error has been logged, and we will fix it soon.`);
	}
	// Release any workers regardless of the result
	cmd.releaseWorker(true);
});

// Setup crash handlers
let lastErrorReport = 0;

async function onError(err: Error | {} | null | undefined, detail: string = "") {
	if (!err) return console.error(`Error with no details thrown.`);
	// Don't flood the error report channel, only report 1 error per minute.
	if (Date.now() > lastErrorReport + (1000 * 60)) {
		try {
			const reportChannel = await client.channels.fetch(`${process.env.ERRCHANNEL}`);
			if (reportChannel && ['text', 'news'].includes(reportChannel.type)) {
				let msg = `${detail} ${err}`.trim();
				if (err instanceof Error) msg += `\nat: ${err.stack}`;
				(reportChannel as Discord.TextChannel).send(msg);
				lastErrorReport = Date.now();
			}
		} catch (e) {}
	}

	console.error(err);
}

process.on('uncaughtException', async err => onError(err));

process.on('unhandledRejection', async err => onError(err));

client.on('error', async err => onError(err));

// Login
client.login(process.env.TOKEN);
