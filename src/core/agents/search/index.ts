import type { IAgent, IListingSource } from "../../ports/index.js";
import type { GraphState } from "../../../shared/models/index.js";

export class SearchAgent implements IAgent {
  constructor(private readonly source: IListingSource) {}

  async run(state: GraphState): Promise<Partial<GraphState>> {
    const queries =
      state.expandedQueries.length > 0 ? state.expandedQueries : [state.query];

    console.log(
      `\n[SearchAgent] Searching across ${queries.length} variation(s)...`,
    );

    const rawListings = await this.source.searchMany(queries);

    console.log(`[SearchAgent] Collected ${rawListings.length} raw listings (with duplicates).`);
    return { rawListings };
  }
}
