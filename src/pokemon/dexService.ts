import fs = require("fs");
import FuzzyMatching = require('fuzzy-matching');
import { toID } from "../app";
import { Pokemon, Dex } from "./models";

export class DexService {

	private pokemonMap: { [name: string]: Pokemon } = {};
	private dex: Dex = {} as Dex;
	private fuzzyMatching: FuzzyMatching;

	constructor() {
		this.loadFileData();
		this.fuzzyMatching = new FuzzyMatching(this.dex.pokemon.map(p => p.name));
	}

	public getPokemon(name: string): Pokemon | undefined {
		const pokemon = this.pokemonMap[toID(name)];
		if (pokemon) {
			return pokemon;
		}

		const match = this.fuzzyMatching.get(name, undefined);
		return (match.distance >= 0.5)
			? this.pokemonMap[toID(match.value)]
			: undefined;
	}

	private loadFileData(): void {
		this.dex = this.loadFile<Dex>("dex.json");
		this.dex.pokemon.forEach(p => {
			this.pokemonMap[toID(p.name)] = p;
		})
	}

	private loadFile<T>(filename: string): T {
		const rawdata = fs.readFileSync(`data/${filename}`).toString();
		const data:T = JSON.parse(rawdata);
		return data;
	}
}
