/**
 * rmt.ts
 * A chat monitor for notifiying team raters when a user
 * posts a team to be rated.
 * Also see src/commands/rmt.ts
 */
import Discord = require('discord.js');
import {toID, pgPool} from '../common';
import {BaseMonitor} from '../command_base';

const cooldowns: {[channelid: string]: {[formatid: string]: number}} = {};

export class TeamRatingMonitor extends BaseMonitor {
	private format: string;
	private teamPasteRegexp: RegExp;
	private prefixRegexp: RegExp;
	private formatRegexp: RegExp;
	private raters: string[];

	constructor(message: Discord.Message) {
		super(message, 'RMT Monitor');
		this.format = '';
		this.teamPasteRegexp = /https:\/\/pokepast\.es\/[0-9a-z]{16}/;
		this.prefixRegexp = /^(?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY)/i;
		// eslint-disable-next-line max-len
		this.formatRegexp = /\b((?:SWSH|SS|USUM|SM|ORAS|XY|B2W2|BW2|BW|HGSS|DPP|DP|RSE|ADV|GSC|RBY|Gen ?[1-8]\]?)? ?(?:(?:Nat|National) ?Dex|Doubles|D)? ?(?:[OURNPZ]U|AG|LC|VGC|OM|BS[SD]|(?:Over|Under|Rarely|Never|Zero)used|Ubers?|Monotype|Little ?Cup|Nat ?Dex|Anything ?Goes|Video ?Game ?Championships?|Battle ?(?:Spot|Stadium) ?(?:Singles?|Doubles?)|1v1|Other ?Meta(?:s|games?)?))\b/i;
		this.raters = [];
	}

	private transformFormat(formatid: string): string {
		const matches = this.prefixRegexp.exec(formatid);
		if (matches) {
			// Covert to the Gen # format
			const gens: {[key: string]: number} = {
				swsh: 8,
				ss: 8,
				usum: 7,
				sm: 7,
				oras: 6,
				xy: 6,
				b2w2: 5,
				bw2: 5,
				bw: 5,
				hgss: 4,
				dpp: 4,
				dp: 4,
				rse: 3,
				adv: 3,
				gsc: 2,
				rby: 1,
			};
			formatid = formatid.replace(matches[0], 'gen' + (gens[matches[0]] || 8));
		}
		if (!formatid.startsWith('gen')) {
			formatid = `gen8${formatid}`;
		}
		if (formatid === 'gen8natdexou') formatid = 'gen8natdex';
		return formatid;
	}

	async shouldExecute() {
		let res = await pgPool.query('SELECT channelid FROM teamraters WHERE channelid = $1', [this.channel.id]);
		if (!res.rows.length) return false; // This channel isn't setup for team rating.

		if (!this.teamPasteRegexp.test(this.target)) return false;
		const format = this.formatRegexp.exec(this.target);
		if (!format || !format.length) return false;
		this.format = this.transformFormat(toID(format[0]));
		if (!this.format.startsWith('gen')) return false;
		res = await pgPool.query(
			'SELECT userid FROM teamraters WHERE format = $1 AND channelid = $2',
			[this.format, this.channel.id]
		);
		if (!res.rows.length) {
			return false; // No results
		} else {
			res.rows = res.rows.filter(r => {
				const user = this.getUser(r.userid);
				if (!user || user.presence.status === 'offline') return false;
				return true;
			});

			if (!res.rows.length) return false;
			this.raters = res.rows.map(r => `<@${r.userid as string}>`);
		}
		const cooldown = cooldowns[this.channel.id]?.[this.format];
		if (cooldown && cooldown + (1000 * 60 * 60) >= Date.now()) return false;
		if (!cooldowns[this.channel.id]) cooldowns[this.channel.id] = {};
		cooldowns[this.channel.id][this.format] = Date.now();
		return true;
	}

	async execute() {
		await this.reply(`Tagging ${this.format} team raters: ${this.raters.join(', ')}`);
	}
}
