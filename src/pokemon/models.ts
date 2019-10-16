export interface Dex {
	pokemon: Pokemon[];
	formats: Format[];
	natures: Nature[];
	abilities: Ability[];
	moveflags: Moveflag[];
	moves: Move[];
	types: Type[];
	items: Ability[];
}
  
interface Type {
	name: string;
	atk_effectives: (number | string)[][];
	genfamily: string[];
	description: string;
}
  
interface Move {
	name: string;
	cap: boolean;
	category: string;
	power: number;
	accuracy: number;
	priority: number;
	pp: number;
	description: string;
	type: string;
	flags: string[];
	genfamily: string[];
}
  
interface Moveflag {
	name: string;
	description: string;
	genfamily: string[];
}
  
interface Ability {
	name: string;
	description: string;
	cap: boolean;
	genfamily: string[];
}
  
interface Nature {
	name: string;
	hp: number;
	atk: number;
	def: number;
	spa: number;
	spd: number;
	spe: number;
	summary: string;
	genfamily: string[];
}
  
interface Format {
	name: string;
	shorthand: string;
	genfamily: string[];
}

export interface Pokemon {
	name: string;
	hp: number;
	atk: number;
	def: number;
	spa: number;
	spd: number;
	spe: number;
	weight: number;
	height: number;
	types: PokemonType[];
	abilities: string[];
	formats: string[];
	oob?: Oob;
}
  
interface Oob {
	dex_number: number;
	cap: boolean;
	evos: string[];
	alts: string[];
	genfamily: string[];
}
  
export enum PokemonType {
	Bug      = "Bug",
	Dark     = "Dark",
	Dragon   = "Dragon",
	Electric = "Electric", 
	Fairy    = "Fairy",
	Fighting = "Fighting",
	Fire     = "Fire",
	Flying   = "Flying",
	Ghost    = "Ghost",
	Grass    = "Grass",
	Ground   = "Ground",
	Ice      = "Ice",
	Normal   = "Normal",
	Poison   = "Poison",
	Psychic  = "Psychic",
	Rock     = "Rock",
	Steel    = "Steel",
	Water    = "Water"
}