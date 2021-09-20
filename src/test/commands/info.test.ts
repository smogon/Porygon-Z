/**
 * Tests for the info module.
 * This is intended as a blueprint from which more complex and necessary tests can be created.
 *
 * @author Annika
 */

import {prefix} from '../../common';
import {client} from '../../client';
// This is a load bearing import order.
// If we load client.ts after loading commands/info.ts, all exported members of the latter show as undefined.
// I think this is a bug in ts-jest, and it thinks we're trying to mock info.ts, based on https://github.com/kulshekhar/ts-jest/issues/120.
import {Directory, Github, Help, Wifi} from '../../commands/info';

import {Guild, Message, Client} from '../fake-discord';

describe('informational commands', () => {
	jest.clearAllMocks();
	const guild = new Guild(new Client());

	afterAll(() => {
		guild.client.destroy();
		client.destroy();
	});

	test('the `$github` command', async () => {
		const message = new Message(guild, '$github');
		const command = new Github(message);
		await command.execute();
		expect(message.getResponse()).toMatch(/Porygon-Z is open source.*github.com/);
	});

	test('the `$directory` command', async () => {
		const message = new Message(guild, '$directory');
		const command = new Directory(message);
		await command.execute();
		expect(message.getResponse()).toMatch(/smogon\.com\/discord\/directory/);
	});

	test('the `$wifi` command', async () => {
		const message = new Message(guild, '$wifi');
		const command = new Wifi(message);
		await command.execute();
		expect(message.getResponse()).toMatch(/WiFi discord/);
	});

	describe('the `$help` command', () => {
		it('should work for all commands', async () => {
			const message = new Message(guild, `${prefix}help`);
			const command = new Help(message);
			await command.execute();

			let embed = message.getResponse() as {[k: string]: any};
			if (embed.embed) embed = embed.embed;

			expect(embed.description).toBe('Help for All Commands');
			expect(embed.fields.length).toBeGreaterThan(3);
		});

		it('should work for a specific command', async () => {
			const message = new Message(guild, `${prefix}help help`);
			const command = new Help(message);
			await command.execute();

			let embed = message.getResponse() as {[k: string]: any};
			if (embed.embed) embed = embed.embed;

			expect(embed.description).toBe('Help for the selected command');
			expect(embed.fields).toHaveLength(1);
			expect(embed.fields[0]).toMatchObject({name: `${prefix}help`, value: Help.help()});
		});
	});
});
