/**
 * info.ts
 * Basic information related commands.
 */
import Discord = require('discord.js');
import { commands } from '../app';
import { ID, prefix, toID, pgPool } from '../common';
import { BaseCommand, DiscordChannel, IAliasList, ReactionPageTurner } from '../command_base';

class HelpPage extends ReactionPageTurner {
	protected lastPage: number;
	private rowsPerPage: number;
	private data: {[key: string]: string}[];
	constructor(channel: DiscordChannel, user: Discord.User, data: {[key: string]: string}[]) {
		super(channel, user);
		this.data = data;
		this.lastPage = Math.ceil(this.data.length / 10);
		this.rowsPerPage = 5;

		this.initalize(channel);
	}

	buildPage(guild: Discord.Guild): Discord.MessageEmbed {
		let embed: Discord.MessageEmbedOptions = {
			color: 0x6194fd,
			description: `Help for All Commands`,
			author: {
				name: 'Help',
				icon_url: this.user.displayAvatarURL(),
			},
			timestamp: Date.now(),
			footer: {
				text: `Page: ${this.page}/${this.lastPage}`,
			}
		}
		embed.fields = []; // To appease typescript, we do this here

		for (let i = (this.page - 1) * this.rowsPerPage; i < (((this.page - 1) * this.rowsPerPage) + this.rowsPerPage); i++) {
			const row = this.data[i];
			if (!row) break; // No more data

			embed.fields.push({
				name: `${prefix}${row.name}`,
				value: row.help,
			});
		}

		if (!embed.fields.length) embed.fields.push({
			name: 'No Commands Found',
			value: 'Thats strange, maybe something broke?',
		});

		return new Discord.MessageEmbed(embed);
	}
}


export const aliases: IAliasList = {
	help: ['h'],
};

export class Help extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		if (this.target) {
			// Specfic command
			let cmd = commands.get(toID(this.target));
			if (typeof cmd === 'string') {
				this.target = cmd;
				cmd = commands.get(cmd); // Alias
			}
			if (typeof cmd === 'string') throw new Error(`Possible alias loop with command: ${this.target}`);
			let str = '';
			if (!cmd) {
				str = BaseCommand.help();
			} else {
				// @ts-ignore Is a class and I cant figure out how to tell typescript help is its static member
				str = cmd.help();
			}

			let embed: Discord.MessageEmbedOptions = {
				color: 0x6194fd,
				description: `Help for the selected command`,
				author: {
					name: 'Help',
					icon_url: this.author.displayAvatarURL(),
				},
				fields: [{
						name: `${prefix}${toID(this.target)}`,
						value: str,
					}],
				timestamp: Date.now(),
			}

			this.channel.send({embed: embed});
		} else {
			// General help
			let data: {[key: string]: string}[] = [];

			for (let [k, v] of commands) {
				if (typeof v === 'string') continue;
				// @ts-ignore Is a class and I cant figure out how to tell typescript help is its static member
				let desc: string = v.help();
				// If there is no description or its the default, do not show the command publically
				if (!toID(desc) || desc === BaseCommand.help()) continue;

				data.push({name: toID(k), help: desc});
			}

			new HelpPage(this.channel, this.author, data);
		}
	}

	public static help(): string {
		return `${prefix}help [command] - Get help for a command. Exclude the command to get help for all commands.\n` +
			`Aliases: ${aliases.help.map(a => `${prefix}${a}`)}`;
	}
}

export class Directory extends BaseCommand {
	constructor(message: Discord.Message) {
		super(message);
	}

	public async execute() {
		this.reply(`Here's a link to the Smogon Discord Server Directory! https://www.smogon.com/discord/directory`);
	}

	public static help(): string {
		return `${prefix}directory - Get the link for the smogon discord directory.\n` +
			`Aliases: None`;
	}
}
