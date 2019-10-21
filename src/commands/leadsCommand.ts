import Discord = require('discord.js');
import { ColorService } from '../pokemon/colorService';
import { BaseCommand, aliasList } from '../command_base';
import { SmogonFormat } from '../ps-stats/models';
import { AppServices } from '../appServices';
import { Pokemon } from '../pokemon/models';

export const aliases: aliasList = {
	LeadsCommand: ['stats-leads'],
};

export class LeadsCommand extends BaseCommand {
	constructor(message: Discord.Message, services: AppServices) {
		super('stats-leads', message, services);
	}
	
	execute() {
		const format = { generation: "gen7", tier: "ou" } as SmogonFormat;
		const leads = this.services.stats.getLeads(format);
		const firstMon = this.services.dex.getPokemon(leads[0].name) || {} as Pokemon;

		const embed = new Discord.RichEmbed()
			.setColor(ColorService.getColorForType(firstMon.types[0]))
			.setThumbnail(`https://play.pokemonshowdown.com/sprites/bw/${firstMon.name.toLowerCase()}.png`)

		leads.forEach((mon, i) => {
			embed.addField(`Lead ${i + 1}º ${mon.name}`, `Usage: ${mon.usagePercentage.toFixed(2)}%`, true);
		});

		const msgHeader = `**__Leads:__** Top 10 leads of Gen 7 OU`;
		this.message.channel.send(msgHeader, embed);
	}
}
