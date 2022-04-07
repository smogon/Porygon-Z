/**
 * File containing the discord.js client.
 *
 * This can't just go in app.ts because unit tests need to require commands
 * (some of which depend on the client) without actually logging in.
 */

import Discord = require('discord.js');
import fs = require('fs');

import {prefix, ID, toID, database} from './common';
import {BaseCommand, BaseMonitor, DiscordChannel} from './command_base';
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

export const client = new Discord.Client({
	intents: [
		// For reporting ban info
		Discord.Intents.FLAGS.GUILD_BANS,
		// For checking if a user is set as offline
		Discord.Intents.FLAGS.GUILD_PRESENCES,
		// For reading messages
		Discord.Intents.FLAGS.GUILD_MESSAGES,
		Discord.Intents.FLAGS.DIRECT_MESSAGES,
		// For checking reactions on messages
		Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
		Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
		// TODO determine if this is needed
		// Discord.Intents.FLAGS.GUILDS,
	],
});

// Necessary to match process.on('uncaughtException')
// eslint-disable-next-line @typescript-eslint/ban-types
export async function onError(err: any, detail = '') {
	if (!err) return console.error('Error with no details thrown.');
	// Don't flood the error report channel, only report 1 error per minute.
	if (Date.now() > lastErrorReport + (1000 * 60)) {
		try {
			const reportChannel = await client.channels.fetch(`${process.env.ERRCHANNEL}`);
			if (reportChannel && ['text', 'news'].includes(reportChannel.type)) {
				const stack = (err instanceof Error) ? err.stack : err;
				const msg = `${detail} ${stack}`.trim();
				await (reportChannel as Discord.TextChannel).send(msg);
				lastErrorReport = Date.now();
			}
		} catch (e) {
			// Error handling threw an error, just log we had an issue to console
			console.error('Error while handling error: ', e);
		}
	}

	console.error(err);
}

// Map of Command Classes - Build before use
export const commands = new Discord.Collection<ID, Constructable<BaseCommand> | ID>();
// Map of Chat Monitors - Build before use
export const monitors = new Discord.Collection<ID, Constructable<BaseMonitor>>();

// Load commands
const commandFiles = fs.readdirSync(`${__dirname}/commands`).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
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

export async function verifyData(data: Discord.Message | IDatabaseInsert) {
	if (lockdown) return;

	// Server
	if (data.guild && !servers.has(data.guild.id)) {
		const res = await database.queryWithResults('SELECT * FROM servers WHERE serverid = $1', [data.guild.id]);
		if (!res.length) {
			await database.query(
				'INSERT INTO servers (serverid, servername, logchannel, sticky) VALUES ($1, $2, $3, $4)',
				[data.guild.id, data.guild.name, null, []]
			);
		}
		servers.add(data.guild.id);
	}

	// Channel
	if (data.guild && data.channel && ['text', 'news'].includes(data.channel.type) && !channels.has(data.channel.id)) {
		const channel = (data.channel as Discord.TextChannel | Discord.NewsChannel);
		const res = await database.queryWithResults('SELECT * FROM channels WHERE channelid = $1', [channel.id]);
		if (!res.length) {
			await database.query(
				'INSERT INTO channels (channelid, channelname, serverid) VALUES ($1, $2, $3)',
				[channel.id, channel.name, data.guild.id]
			);
		}
		channels.add(data.channel.id);
	}

	// User
	if (data.author && !users.has(data.author.id)) {
		const res = await database.queryWithResults('SELECT * FROM users WHERE userid = $1', [data.author.id]);
		if (!res.length) {
			await database.query(
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
			const res = await database.queryWithResults(
				'SELECT * FROM userlist WHERE serverid = $1 AND userid = $2',
				[data.guild.id, data.author.id]
			);
			if (!res.length) {
				await database.query(
					'INSERT INTO userlist (serverid, userid, boosting, sticky) VALUES ($1, $2, $3, $4)',
					[data.guild.id, data.author.id, null, []]
				);
			}
			userlist.add(data.guild.id + ',' + data.author.id);
		}
	}
}

// Load Monitors
const monitorFiles = fs.readdirSync(`${__dirname}/monitors`).filter(f => f.endsWith('.js' || f.endsWith('.ts')));
for (const file of monitorFiles) {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const monitorModule: IMonitorModule = require(`${__dirname}/monitors/${file}`);
	for (const monitor in monitorModule) {
		monitors.set(toID(monitor), monitorModule[monitor]);
	}
}

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


// Setup crash handlers
let lastErrorReport = 0;

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
	if (msg.webhookId) return;
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
				await onError(e as Error, 'A chat monitor crashed: ');
			}
		}
		return;
	}
	// Attempt to run the request command if it exists.
	// Skip if this is a PM.
	if (lockdown) return msg.reply('The bot is restarting soon, please try again in a minute.');

	const cmdID = toID(msg.content.slice(prefix.length).split(' ')[0]);
	let Command = commands.get(cmdID);
	if (typeof Command === 'string') Command = commands.get(Command);
	// Throw if it's another alias
	if (typeof Command === 'string') throw new Error(`Alias "${cmdID}" did not point to command.`);
	if (!Command) return;

	// 100% not an alias, so it must be a command class.
	const cmd = new Command(msg);
	try {
		await cmd.execute();
	} catch (e) {
		await onError(e as Error, 'A chat command crashed: ');
		await msg.channel.send(
			'\u274C - An error occured while trying to run your command. The error has been logged, and we will fix it soon.'
		);
	}
})(m));

client.on('error', err => void onError(err));
