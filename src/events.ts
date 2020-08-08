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

	if (!log) return;

	if (Date.now() - log.createdTimestamp > 2000) return; // Old entry, ignore

	return log;
}

async function canAssignRole(user: Discord.GuildMember, role: Discord.Role): Promise<boolean> {
	let guild = user.guild;
	if (user.guild.id !== guild.id || role.guild.id !== guild.id) throw new Error(`Guild missmatch when re-assigning sticky role`);

	await guild.roles.fetch();
	const highestRole = [...user.roles.cache.values()].sort((a, b) => {
		return b.comparePositionTo(a);
	})[0];
	if (role.comparePositionTo(highestRole) >= 0) return false;
	return true;
}

client.on('messageDelete', async (oldMessage: Discord.Message | Discord.PartialMessage) => {
	oldMessage = (oldMessage as Discord.Message);
	if (!oldMessage.guild) return; // Drop PMs
	if (oldMessage.author.bot) return; // Ignore bot message deletes
	const logChannel = await getLogChannel(oldMessage.guild);
	if (!logChannel) return; // Nowhere to log to

	const log = await fetchAuditLog('MESSAGE_DELETE', oldMessage.guild);
	if (!log || log.executor.tag === oldMessage.author.tag) return; // Not a mod delete

	// Don't report for private channels
	await oldMessage.guild.roles.fetch();
	const everyone = oldMessage.guild.roles.everyone; // everyone is always a role
	if (!everyone) throw new Error(`Unable to find the everyone role in the messageDelete event`);
	const permissions = (oldMessage.channel as Discord.TextChannel | Discord.NewsChannel).permissionOverwrites.get(everyone.id);
	if (permissions && permissions.deny.has('VIEW_CHANNEL')) {
		// There are custom permissions for @everyone on this channel, and @everyone cannot view the channel.
		return;
	}

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
			{
				name: 'Deleted by',
				value: `<@${log.executor.id}>`,
			},
		],
		timestamp: Date.now(),
	};

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
				value: log ? `by <@${log.executor.id}>` : 'by Unknown',
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

client.on('guildMemberAdd', async (member: Discord.GuildMember | Discord.PartialGuildMember) => {
	member = (member as Discord.GuildMember);
	const guild = member.guild;
	const bot = guild.me ? await guild.members.fetch(guild.me.user) : null;
	if (!bot) throw new Error(`Bot user not found.`);
	let worker = await pgPool.connect();

	// try/catch so we don't leave a database worker out of the pool incase of an error
	try {
		let res = await worker.query(`SELECT sticky FROM userlist WHERE serverid = $1 AND userid = $2`, [guild.id, member.user.id]);
		if (!res.rows.length) return; // User was not in database yet, which is OK here. Proably a first time join.
		const sticky: string[] = res.rows[0].sticky;
		if (!sticky.length) return; // User rejoined and had 0 sticky roles.

		// Re-assign sticky roles
		if (!bot.hasPermission('MANAGE_ROLES')) {
			// Bot can't assign roles due to lack of permissions
			const channel = await getLogChannel(guild);
			let msg = `[WARN] Bot tried to assign sticky (persistant) roles to a user joining the server, but lacks the MANAGE_ROLES permission.`;
			if (channel) channel.send(msg);
			return;
		}

		await guild.roles.fetch();
		for (let roleID of sticky) {
			const role = guild.roles.cache.get(roleID);
			if (!role) {
				// ??? Should never happen
				throw new Error(`Unable to find sticky role with ID ${roleID} in server ${guild.name} (${guild.id})`);
			}

			if (!canAssignRole(bot, role)) {
				// Bot can no longer assign the role.
				const channel = await getLogChannel(guild);
				let msg = `[WARN] Bot tried to assign sticky (persistant) role "${role.name}" to a user joining the server, but lacks permissions to assign this specific role.`;
				if (channel) channel.send(msg);
				continue;
			}

			member.roles.add(role, 'Assigning sticky role to returning user');
		}
	} catch (e) {
		worker.release();
		throw e;
	}
});

client.on('roleDelete', async (role: Discord.Role) => {
	const guild = role.guild;
	let worker = await pgPool.connect();

	try {
		let res = await worker.query(`SELECT sticky FROM servers WHERE serverid = $1`, [guild.id]);
		let sticky = res.rows[0].sticky;
		if (!sticky.includes(role.id)) return; // Deleted role is not sticky

		// Remove references to sticky role
		sticky = sticky.splice(sticky.indexOf(role.id), 1);
		await worker.query(`UPDATE servers SET sticky = $1 WHERE serverid = $2`, [sticky, guild.id]);

		// Remove role from userlist
		await worker.query(`UPDATE userlist SET sticky = array_remove(sticky, $1) WHERE serverid = $2 AND sticky @> ARRAY[$1]`, [role.id, guild.id]);
	} catch(e) {
		worker.release();
		throw e;
	}
});

client.on('guildMemberUpdate', async (oldMember: Discord.GuildMember | Discord.PartialGuildMember, newMember: Discord.GuildMember | Discord.PartialGuildMember) => {
	oldMember = (oldMember as Discord.GuildMember);
	newMember = (newMember as Discord.GuildMember);
	const guild = newMember.guild;

	let addedRoles = [...newMember.roles.cache.values()].filter(role => !oldMember.roles.cache.has(role.id));
	let removedRoles = [...oldMember.roles.cache.values()].filter(role => !newMember.roles.cache.has(role.id));

	if (!addedRoles.length && !removedRoles.length) return;

	const stickyRoles: string[] = (await pgPool.query('SELECT sticky FROM servers WHERE serverid = $1', [guild.id])).rows[0].sticky;
	addedRoles = addedRoles.filter(role => stickyRoles.includes(role.id));
	removedRoles = removedRoles.filter(role => stickyRoles.includes(role.id));

	if (!addedRoles.length && !removedRoles.length) return;

	let userRoles: string[] = (await pgPool.query('SELECT sticky FROM userlist WHERE serverid = $1 AND userid = $2', [guild.id, newMember.user.id])).rows[0].sticky;
	userRoles = userRoles.filter(roleID => !removedRoles.map(r => r.id).includes(roleID));
	userRoles = userRoles.concat(addedRoles.map(r => r.id));

	await pgPool.query('UPDATE userlist SET sticky = $1 WHERE serverid = $2 AND userid = $3', [userRoles, guild.id, newMember.user.id]);
});
