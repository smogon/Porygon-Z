import { PokemonType } from "./models";

export class ColorService {

	private static typeColorMap: { [id: string] : string; } = {};
	private static versionColorMap: { [id: string] : string; } = {};
	
	public static getColorForType(type: PokemonType): string 	{
		return this.typeColorMap[type];
	}
	
	public static getColorForVersion(version: string): string {
		version = version.toLowerCase();
		return this.versionColorMap[version];
	}
	
	public getColorForAbility(): string {
		return '#66E1FB';
	}
	
	public getColorForItem(): string {
		return '#E89800';
	}
	
	static initialize(): void {
		this.typeColorMap[PokemonType.Normal]   = '#A8A77A';
		this.typeColorMap[PokemonType.Fighting] = '#C22E28';
		this.typeColorMap[PokemonType.Flying]   = '#A98FF3';
		this.typeColorMap[PokemonType.Poison]   = '#A33EA1';
		this.typeColorMap[PokemonType.Ground]   = '#E2BF65';
		this.typeColorMap[PokemonType.Rock]     = '#B6A136';
		this.typeColorMap[PokemonType.Bug]      = '#A6B91A';
		this.typeColorMap[PokemonType.Ghost]    = '#735797';
		this.typeColorMap[PokemonType.Steel]    = '#B7B7CE';
		this.typeColorMap[PokemonType.Fire]     = '#EE8130';
		this.typeColorMap[PokemonType.Water]    = '#6390F0';
		this.typeColorMap[PokemonType.Grass]    = '#7AC74C';
		this.typeColorMap[PokemonType.Electric] = '#F7D02C';
		this.typeColorMap[PokemonType.Psychic]  = '#F95587';
		this.typeColorMap[PokemonType.Ice]      = '#96D9D6';
		this.typeColorMap[PokemonType.Dragon]   = '#6F35FC';
		this.typeColorMap[PokemonType.Dark]     = '#705746';
		this.typeColorMap[PokemonType.Fairy]    = '#D685AD';
		
		this.versionColorMap["red"] =  '#FF1111';
		this.versionColorMap["blue"] =  '#1111FF';
		this.versionColorMap["yellow"] =  '#FFD733';
		this.versionColorMap["gold"] =  '#DAA520';
		this.versionColorMap["silver"] =  '#C0C0C0';
		this.versionColorMap["crystal"] =  '#4fD9FF';
		this.versionColorMap["ruby"] =  '#A00000';
		this.versionColorMap["sapphire"] =  '#0000A0';
		this.versionColorMap["emerald"] =  '#00A000';
		this.versionColorMap["firered"] =  '#FF7327';
		this.versionColorMap["leafgreen"] =  '#00DD00';
		this.versionColorMap["diamond"] =  '#AAAAFF';
		this.versionColorMap["pearl"] =  '#FFAAAA';
		this.versionColorMap["platinum"] =  '#999999';
		this.versionColorMap["heartgold"] =  '#B69E00';
		this.versionColorMap["soulsilver"] =  '#C0C0E1';
		this.versionColorMap["black"] =  '#444444';
		this.versionColorMap["white"] =  '#E1E1E1';
		this.versionColorMap["black2"] =  '#444444';
		this.versionColorMap["white2"] =  '#E1E1E1';
		this.versionColorMap["x"] =  '#6376B8';
		this.versionColorMap["y"] =  '#ED5540';
		this.versionColorMap["omegaruby"] =  '#CF3025';
		this.versionColorMap["alphasapphire"] =  '#1768D1';
		this.versionColorMap["sun"] =  '#F1912B';
		this.versionColorMap["moon"] =  '#5599CA';
		this.versionColorMap["ultrasun"] =  '#FAA71B';
		this.versionColorMap["ultramoon"] =  '#179CD7';
	}
}
ColorService.initialize();
