/**
 * Mocks for the Discord.js library, to be used for tests.
 *
 * Basic idea for how to mock thanks to https://stackoverflow.com/questions/60916450/jest-testing-discord-bot-commands/
 *
 * @author Annika
 */

import OriginalDiscord = require('discord.js');

export class Client extends OriginalDiscord.Client {
	constructor(options?: OriginalDiscord.ClientOptions) {
		super(options);
		this.token = 'not a real token';
	}

	async login(token: string | undefined) {
		return Promise.resolve(token || '');
	}
}

export class Guild extends OriginalDiscord.Guild {
	constructor(client: Client) {
		super(client, {});
	}
}

export class TextChannel extends OriginalDiscord.TextChannel {
	readonly sendHistory: (string | {[k: string]: any})[];
	constructor(guild: OriginalDiscord.Guild) {
		super(guild, {});
		this.sendHistory = [];
	}

	send(content: OriginalDiscord.StringResolvable) {
		this.sendHistory.push(content);
		return Promise.resolve(new Message(this.guild, content)) as any;
	}

	getLastSentMessage() {
		return this.sendHistory[this.sendHistory.length - 1];
	}
}

export class Message extends OriginalDiscord.Message {
	readonly channel: TextChannel;
	readonly reactionsList: OriginalDiscord.EmojiIdentifierResolvable[];
	constructor(guild: Guild, text: string) {
		const channel = new TextChannel(guild);
		super(guild.client, {content: text}, channel);
		this.channel = channel;
		this.author = new OriginalDiscord.User(guild.client, {id: 42});
		this.reactionsList = [];
	}

	getResponse() {
		return this.channel.getLastSentMessage();
	}

	react(emoji: OriginalDiscord.EmojiIdentifierResolvable): Promise<OriginalDiscord.MessageReaction> {
		this.reactionsList.push(emoji);
		return Promise.resolve(new OriginalDiscord.MessageReaction(this.client, {emoji, animated: false}, this));
	}

	getReactions() {
		return this.reactionsList;
	}
}
