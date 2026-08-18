import type { IAgent, ILLMProvider } from "../../ports/index.js";
import type {
  GraphState,
  ListingWithDelta,
  PriceAnalysis,
  TopPick,
} from "../../../shared/models/index.js";
import { analysisPrompt } from "./prompt.js";
import { analysisSchema, type AnalysisSchemaOutput } from "./schema.js";

export class AnalysisAgent implements IAgent {
  constructor(private readonly llmProvider: ILLMProvider) {}

  async run(state: GraphState): Promise<Partial<GraphState>> {
    if (state.listingsWithHistory.length === 0) {
      throw new Error("AnalysisAgent: no listings available for analysis");
    }

    console.log(
      `\n[AnalysisAgent] Analyzing ${state.listingsWithHistory.length} listings with Gemini...`,
    );

    const chain = analysisPrompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(analysisSchema),
    );

    const response = (await chain.invoke({
      query: state.query,
      variations: state.expandedQueries.join(" | "),
      listings: JSON.stringify(state.listingsWithHistory, null, 2),
    })) as AnalysisSchemaOutput;

    const analysis = this.toAnalysis(response, state.listingsWithHistory);

    console.log(
      `[AnalysisAgent] Top pick: ${analysis.topPicks[0]?.listing.title ?? "N/A"} (score ${analysis.topPicks[0]?.score ?? "N/A"})`,
    );

    return { analysis };
  }

  private toAnalysis(
    response: AnalysisSchemaOutput,
    listings: ListingWithDelta[],
  ): PriceAnalysis {
    return {
      topPicks: this.buildTopPicks(response, listings),
      cheapestListing: this.findById(listings, response.cheapestListingId),
      averagePrice: response.averagePrice,
      priceRange: { min: response.minPrice, max: response.maxPrice },
      marketVariationPercent: response.marketVariationPercent,
      significantDrops: response.significantDropListingIds
        .map((id) => this.findById(listings, id))
        .filter((listing): listing is ListingWithDelta => listing !== null),
      recommendation: response.recommendation,
    };
  }

  private buildTopPicks(
    response: AnalysisSchemaOutput,
    listings: ListingWithDelta[],
  ): TopPick[] {
    return response.topPicks
      .map((pick): TopPick | null => {
        const listing = this.findById(listings, pick.listingId);
        if (!listing) return null;
        return {
          listing,
          score: pick.score,
          reasoning: pick.reasoning,
        };
      })
      .filter((pick): pick is TopPick => pick !== null);
  }

  private findById(
    listings: ListingWithDelta[],
    id: string,
  ): ListingWithDelta | null {
    return listings.find((listing) => listing.listingId === id) ?? null;
  }
}
