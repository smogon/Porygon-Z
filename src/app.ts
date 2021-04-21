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

import {prefix, ID, toID, pgPool} from './common';
import {BaseCommand, BaseMonitor, DiscordChannel} from './command_base';
import {updateDatabase} from './database_version_control';
import * as child_process from 'child_process';

interface Constructable<T> {
	new(message: Discord.Message): T;
	help(): string;
	init(): Promise<void>;
}

interface CommandAliases {
	[key: string]: string[];
}

interface ICommandModule {
	[key: string]: Constructable<BaseCommand> | CommandAliases;
}
interface IMonitorModule {
	[key: string]: Constructable<BaseMonitor>;
}

interface IDatabaseInsert {
	author?: Discord.User; // Called author so it's more compatible with Discord.Message
	guild?: Discord.Guild;
	channel?: DiscordChannel;
}

// Ensure database properly setup
void updateDatabase();

// Shutdown helper
let lockdown = false;
export function shutdown() {
	lockdown = true;
}

// Database cache sets
const users = new Set<string>();
const servers = new Set<string>();
const channels = new Set<string>();
const userlist = new Set<string>();

export async function verifyData(data: Discord.Message | IDatabaseInsert) {
	if (lockdown) return;
	let worker = null;

	// Server
	if (data.guild && !servers.has(data.guild.id)) {
		if (!worker) worker = await pgPool.connect();
		const res = await worker.query('SELECT * FROM servers WHERE serverid = $1', [data.guild.id]);
		if (!res.rows.length) {
			await worker.query(
				'INSERT INTO servers (serverid, servername, logchannel, sticky) VALUES ($1, $2, $3, $4)',
				[data.guild.id, data.guild.name, null, []]
			);
		}
		servers.add(data.guild.id);
	}

	// Channel
	if (data.guild && data.channel && ['text', 'news'].includes(data.channel.type) && !channels.has(data.channel.id)) {
		const channel = (data.channel as Discord.TextChannel | Discord.NewsChannel);
		if (!worker) worker = await pgPool.connect();
		const res = await worker.query('SELECT * FROM channels WHERE channelid = $1', [channel.id]);
		if (!res.rows.length) {
			await worker.query(
				'INSERT INTO channels (channelid, channelname, serverid) VALUES ($1, $2, $3)',
				[channel.id, channel.name, data.guild.id]
			);
		}
		channels.add(data.channel.id);
	}

	// User
	if (data.author && !users.has(data.author.id)) {
		if (!worker) worker = await pgPool.connect();
		const res = await worker.query('SELECT * FROM users WHERE userid = $1', [data.author.id]);
		if (!res.rows.length) {
			await worker.query(
				'INSERT INTO users (userid, name, discriminator) VALUES ($1, $2, $3)',
				[data.author.id, data.author.username, data.author.discriminator]
			);
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
			const res = await worker.query(
				'SELECT * FROM userlist WHERE serverid = $1 AND userid = $2',
				[data.guild.id, data.author.id]
			);
			if (!res.rows.length) {
				await worker.query(
					'INSERT INTO userlist (serverid, userid, boosting, sticky) VALUES ($1, $2, $3, $4)',
					[data.guild.id, data.author.id, null, []]
				);
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
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const commandModule: ICommandModule = require(`${__dirname}/commands/${file}`);
	for (const cmd in commandModule) {
		const mod = commandModule[cmd];
		if (typeof mod === 'function') {
			// It's a command (class)
			commands.set(toID(cmd), mod);
		} else {
			// It's an alias object
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
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const monitorModule: IMonitorModule = require(`${__dirname}/monitors/${file}`);
	for (const monitor in monitorModule) {
		monitors.set(toID(monitor), monitorModule[monitor]);
	}
}

// Load other client events
require('./events');

client.on('ready', () => void (async () => {
	if (!client?.user) throw new Error('Bot not logged in and ready event triggered.'); // Should never happen
	console.log(`Logged in as ${client.user.tag}.`);

	// Startup events

	await Promise.all([
		...commands
			// Aliases cannot be initialized so we skip them
			.filter(cmd => typeof cmd === 'function')
			.map(cmd => (cmd as Constructable<BaseCommand>).init()),
		...monitors.map(monitor => monitor.init()),
	]);

	// Notify systemmd that startup is complete if we are running through systemmd
	if (process.env['INVOCATION_ID']) {
		child_process.spawnSync('systemd-notify', ['--ready', `--pid=${process.pid}`]);
	}
})());

// Fires when we get a new message from discord. We ignore messages that aren't commands or are from a bot.
client.on('message', (m) => void (async msg => {
	if (msg.webhookID) return;
	await verifyData(msg);
	if (msg.author.bot) return;
	if (!msg.content.startsWith(prefix)) {
		if (lockdown) return; // Ignore - bot restarting
		// Handle Chat Monitors
		if (!msg.guild) return; // Ignore PMs
		for (const [, Monitor] of monitors) {
			const monitor = new (Monitor)(msg);
			try {
				if (await monitor.shouldExecute()) {
					await monitor.execute();
				}
			} catch (e) {
				await onError(e, 'A chat monitor crashed: ');
			}
			// Release any workers regardless of the result
			monitor.releaseWorker(true);
		}
		return;
	}
	// Attempt to run the request command if it exists.
	// Skip if this is a PM.
	if (lockdown) return msg.reply('The bot is restarting soon, please try again in a minute.');

	const cmdID = toID(msg.content.slice(prefix.length).split(' ')[0]);
	let command = commands.get(cmdID);
	if (typeof command === 'string') command = commands.get(command);
	// Throw if it's another alias
	if (typeof command === 'string') throw new Error(`Alias "${cmdID}" did not point to command.`);
	if (!command) return;

	// 100% not an alias, so it must be a command class.
	const cmd = new (command as Constructable<BaseCommand>)(msg);
	try {
		await cmd.execute();
	} catch (e) {
		await onError(e, 'A chat command crashed: ');
		await msg.channel.send(
			'\u274C - An error occured while trying to run your command. The error has been logged, and we will fix it soon.'
		);
	}
	// Release any workers regardless of the result
	cmd.releaseWorker(true);
})(m));

// Setup crash handlers
let lastErrorReport = 0;

// Necessary to match process.on('uncaughtException')
// eslint-disable-next-line @typescript-eslint/ban-types
async function onError(err: Error | {} | null | undefined, detail = '') {
	if (!err) return console.error('Error with no details thrown.');
	// Don't flood the error report channel, only report 1 error per minute.
	if (Date.now() > lastErrorReport + (1000 * 60)) {
		try {
			const reportChannel = await client.channels.fetch(`${process.env.ERRCHANNEL}`);
			if (reportChannel && ['text', 'news'].includes(reportChannel.type)) {
				let msg = `${detail} ${err}`.trim();
				if (err instanceof Error) msg += `\nat: ${err.stack}`;
				await (reportChannel as Discord.TextChannel).send(msg);
				lastErrorReport = Date.now();
			}
		} catch (e) {}
	}

	console.error(err);
}

process.on('uncaughtException', err => void onError(err));

process.on('unhandledRejection', err => void onError(err));

client.on('error', err => void onError(err));

// Login
void (async () => client.login(process.env.TOKEN))();
