/**
 * events.ts
 * Stores most discord client events.
 * Exceptions are located in app.ts
 */
import Discord = require('discord.js');
import { ID, prefix, toID, pgPool } from './common';
import { client } from './app';

async function getLogChannel(guild: Discord.Guild): Promise<Discord.TextChannel | void> {
	const res = await pgPool.query(`SELECT logchannel FROM servers WHERE serverid = $1`, [guild.id]);
	if (!res.rows.length) return;
	const channel = client.channels.cache.get(res.rows[0].logchannel);
	if (!channel) return;
	return (channel as Discord.TextChannel);
}

async function fetchAuditLog(type: Discord.GuildAuditLogsAction, guild: Discord.Guild): Promise<Discord.GuildAuditLogsEntry | void> {
	if (!guild.me) return;
	if (!guild.me.hasPermission('VIEW_AUDIT_LOG')) return;

	const log = (await guild.fetchAuditLogs({
		limit: 1,
		type: type,
	})).entries.first();

	if (!log) {
		console.log(`[DEBUG] Had permission but found no log for type ${type} on guild: ${guild}.`);
		return;
	}

	if (Date.now() - log.createdTimestamp > 2000) return; // Old entry, ignore

	return log;
}

client.on('messageUpdate', async (oldMessage: Discord.Message | Discord.PartialMessage, newMessage: Discord.Message | Discord.PartialMessage) => {
	oldMessage = (oldMessage as Discord.Message);
	newMessage = (newMessage as Discord.Message);
	if (!newMessage.guild) return; // Drop PM edits
	if (newMessage.author.bot) return; // Ignore bot edits
	const logChannel = await getLogChannel(newMessage.guild);
	if (!logChannel) return; // Nowhere to log to

	let embed: Discord.MessageEmbedOptions = {
		color: 0x6194fd,
		description: `Message Edited`,
		author: {
			name: newMessage.author.tag,
			icon_url: newMessage.author.displayAvatarURL(),
		},
		fields: [
			{
				name: `Channel`,
				value: `<#${newMessage.channel.id}>`,
			},
			{
				name: `Old Content`,
				value: oldMessage.content,
			},
			{
				name: `New Content`,
				value: newMessage.content,
			}],
		timestamp: Date.now(),
	}

	logChannel.send({embed: embed});
});

client.on('messageDelete', async (oldMessage: Discord.Message | Discord.PartialMessage) => {
	oldMessage = (oldMessage as Discord.Message);
	if (!oldMessage.guild) return; // Drop PMs
	if (oldMessage.author.bot) return; // Ignore bot message deletes
	const logChannel = await getLogChannel(oldMessage.guild);
	if (!logChannel) return; // Nowhere to log to

	// Don't report for private channels
	await oldMessage.guild.roles.fetch();
	const everyone = oldMessage.guild.roles.everyone; // everyone is always a role
	if (!everyone) throw new Error(`Unable to find the everyone role in the messageDelete event`);
	const permissions = (oldMessage.channel as Discord.TextChannel | Discord.NewsChannel).permissionOverwrites.get(everyone.id);
	if (permissions && permissions.deny.has('VIEW_CHANNEL')) {
		// There are custom permissions for @everyone on this channel, and @everyone cannot view the channel.
		return;
	}

	const log = await fetchAuditLog('MESSAGE_DELETE', oldMessage.guild);

	let embed: Discord.MessageEmbedOptions = {
		color: 0x6194fd,
		description: `Message Deleted`,
		author: {
			name: oldMessage.author.tag,
			icon_url: oldMessage.author.displayAvatarURL(),
		},
		fields: [
			{
				name: `Channel`,
				value: `<#${oldMessage.channel.id}>`,
			},
			{
				name: `Old Content`,
				value: oldMessage.content,
			},
		],
		timestamp: Date.now(),
	};

	if (log && log.executor.tag !== oldMessage.author.tag && embed.fields) {
		embed.fields.push({
			name: 'Deleted by',
			value: `<@${log.executor.id}>`,
		});
	}

	logChannel.send({embed: embed});
});

client.on('guildMemberRemove', async (user: Discord.GuildMember | Discord.PartialGuildMember) => {
	user = (user as Discord.GuildMember);
	const logChannel = await getLogChannel(user.guild);
	if (!logChannel) return; // Nowhere to log to

	const log = await fetchAuditLog('MEMBER_KICK', user.guild);

	if (!log || log.executor.id === user.user.id) return; // No log or user left of their own will

	let embed: Discord.MessageEmbedOptions = {
		color: 0x6194fd,
		description: `User kicked`,
		author: {
			name: user.user.tag,
			icon_url: user.user.displayAvatarURL(),
		},
		fields: [
			{
				name: 'By',
				value: `<@${log.executor.id}>`,
			},
			{
				name: 'Reason',
				value: log.reason || 'N/A',
			}
		],
	};

	logChannel.send({embed: embed});
});

async function banChange(guild: Discord.Guild, user: Discord.User | Discord.PartialUser, unbanned: boolean = false) {
	user = (user as Discord.User);
	const logChannel = await getLogChannel(guild);
	if (!logChannel) return; // Nowhere to log to

	const log = await fetchAuditLog(unbanned ? 'MEMBER_BAN_REMOVE' : 'MEMBER_BAN_ADD', guild);

	let embed: Discord.MessageEmbedOptions = {
		color: 0x6194fd,
		description: `User ${unbanned ? 'Unb' : 'B'}anned`,
		author: {
			name: user.tag,
			icon_url: user.displayAvatarURL(),
		},
		fields: [
			{
				name: user.tag,
				value: log ? `by <@${log.executor}>` : 'by Unknown',
			},
			{
				name: 'Reason',
				value: log ? log.reason || 'N/A' : 'N/A',
			}
		],
		timestamp: Date.now(),
	}

	logChannel.send({embed: embed});
}

client.on('guildBanAdd', (guild: Discord.Guild, user: Discord.User | Discord.PartialUser) => {
	banChange(guild, user);
});

client.on('guildBanRemove', (guild: Discord.Guild, user: Discord.User | Discord.PartialUser) => {
	banChange(guild, user, true);
});
