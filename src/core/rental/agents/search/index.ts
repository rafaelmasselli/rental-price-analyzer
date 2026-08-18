import type {
  IRentalAgent,
  IRentalListingSource,
} from "../../../ports/index.js";
import type { RentalGraphState } from "../../../../shared/models/index.js";

export class RentalSearchAgent implements IRentalAgent {
  constructor(private readonly source: IRentalListingSource) {}

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    const queries =
      state.expandedQueries.length > 0 ? state.expandedQueries : [state.query];

    console.log(
      `\n[RentalSearchAgent] Searching across ${queries.length} variation(s)...`,
    );

    const rawListings = await this.source.searchMany(queries);

    console.log(
      `[RentalSearchAgent] Collected ${rawListings.length} raw listings (with duplicates).`,
    );
    return { rawListings };
  }
}
