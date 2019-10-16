import { DexService } from "./pokemon/dexService";
import { StatsService } from "./ps-stats/statsService";

export class AppServices {
	// other singleton services (or factories) might be placed here as well
	public dexService = new DexService();
	public statsService = new StatsService();
}
