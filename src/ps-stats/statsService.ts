import fs = require("fs");
import { PokemonUsage, SmogonFormat } from "./models";

type DbData = { [id: string] : any[]; }
enum StatsType { Leads = "leads" }

export class StatsService {
  
  private database: { [id: string] : DbData; } = {};
  
  public getLeads(format: SmogonFormat): PokemonUsage[] {
    this.ensureDataIsLoaded(StatsType.Leads, format, (data) => {
      return data.data.rows
        .sort((a: any[], b: any[]) => (a[2] - b[2]) * -1) // reverse by usage percentage
        .slice(0, 10)
        .map((itemData: any[]) => {
          return {
            name: itemData[1], 
            usagePercentage: itemData[2], 
            usageRaw: itemData[3] 
          } as PokemonUsage
        });
    });

    const fmt = this.getFormatKey(format);
    return this.database[StatsType.Leads][fmt];
  }

  private ensureDataIsLoaded(statsType: string, format: SmogonFormat, callback?: (data: any) => any): void {
    const fmt = this.getFormatKey(format);
    const dataLoaded = this.database[statsType] && this.database[statsType][fmt];
    if (!dataLoaded) {
      let fileData = this.loadFileData(statsType, format);

      if (callback)
        fileData = callback(fileData);
      
      const data = this.database[statsType] || {} as DbData;
      data[fmt] = fileData;
      this.database[statsType] = data;
    }
  }

  private loadFileData(statsType: string, format: SmogonFormat) {
    const filename = `${statsType}-${this.getFormatKey(format)}`;
    const rawdata = fs.readFileSync(`data/ps-stats/${format.generation}/${format.tier}/${filename}.json`).toString();
    return JSON.parse(rawdata);
  }

  private getFormatKey(format: SmogonFormat): string {
    return format.generation + format.tier;
  }
}