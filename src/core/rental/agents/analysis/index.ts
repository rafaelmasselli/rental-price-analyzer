import type { ILLMProvider, IRentalAgent } from "../../../ports/index.js";
import {
  pricePerM2,
  type RentalAnalysis,
  type RentalGraphState,
  type RentalListingWithDelta,
  type RentalTopPick,
} from "../../../../shared/models/index.js";
import { buildRentalAnalysisPrompt } from "./prompt.js";
import {
  rentalAnalysisSchema,
  type RentalAnalysisOutput,
} from "./schema.js";

export class RentalAnalysisAgent implements IRentalAgent {
  private static readonly DROP_THRESHOLD = -3;

  private readonly prompt: ReturnType<typeof buildRentalAnalysisPrompt>;

  constructor(private readonly llmProvider: ILLMProvider) {
    this.prompt = buildRentalAnalysisPrompt(llmProvider.getProfile().promptStyle);
  }

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    if (state.listingsWithHistory.length === 0) {
      throw new Error("RentalAnalysisAgent: no listings available for analysis");
    }

    console.log(
      `\n[RentalAnalysisAgent] Analyzing ${state.listingsWithHistory.length} rentals with Gemini...`,
    );

    const chain = this.prompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(rentalAnalysisSchema),
    );

    const response = (await chain.invoke({
      query: state.query,
      variations: state.expandedQueries.join(" | "),
      listings: JSON.stringify(this.toPayload(state.listingsWithHistory), null, 2),
    })) as RentalAnalysisOutput;

    const analysis = this.toAnalysis(response, state.listingsWithHistory);

    console.log(
      `[RentalAnalysisAgent] Top pick: ${analysis.topPicks[0]?.listing.title ?? "N/A"} (score ${analysis.topPicks[0]?.score ?? "N/A"})`,
    );

    return { analysis };
  }

  /** Flattened view so the model sees monthly totals, not nested objects. */
  private toPayload(listings: RentalListingWithDelta[]) {
    return listings.map((listing) => ({
      listingId: listing.listingId,
      title: listing.title,
      url: listing.url,
      monthlyTotalBRL: listing.monthlyTotalBRL,
      rentBRL: listing.rentBRL,
      condominioBRL: listing.attributes.condominioBRL,
      iptuMensalBRL: listing.attributes.iptuMensalBRL,
      tipo: listing.attributes.tipo,
      areaM2: listing.attributes.areaM2,
      quartos: listing.attributes.quartos,
      vagas: listing.attributes.vagas,
      bairro: listing.attributes.bairro,
      cidade: listing.attributes.cidade,
      mobiliado: listing.attributes.mobiliado,
      previousMonthlyTotal: listing.previousMonthlyTotal,
      changePercent: listing.changePercent,
      observationCount: listing.observationCount,
      rating: listing.rating
        ? {
            classification: listing.rating.classification,
            fairMonthlyTotalBRL: listing.rating.fairMonthlyTotalBRL,
            deltaPercent: listing.rating.deltaPercent,
            pricePerM2: listing.rating.pricePerM2,
            benchmark: listing.rating.benchmark,
            warnings: listing.rating.warnings,
          }
        : null,
    }));
  }

  private toAnalysis(
    response: RentalAnalysisOutput,
    listings: RentalListingWithDelta[],
  ): RentalAnalysis {
    const totals = listings.map((listing) => listing.monthlyTotalBRL);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const rates = listings
      .map((listing) => pricePerM2(listing))
      .filter((rate): rate is number => rate !== null);

    return {
      topPicks: this.buildTopPicks(response, listings),
      cheapestListing: this.cheapest(listings, response.cheapestListingId),
      averageMonthlyTotal: Math.round(
        totals.reduce((sum, value) => sum + value, 0) / totals.length,
      ),
      monthlyTotalRange: { min, max },
      medianPricePerM2:
        rates.length > 0 ? Number(this.median(rates).toFixed(2)) : null,
      marketVariationPercent:
        min > 0 ? Number((((max - min) / min) * 100).toFixed(2)) : 0,
      significantDrops: this.resolveDrops(response, listings),
      recommendation: response.recommendation,
    };
  }

  private buildTopPicks(
    response: RentalAnalysisOutput,
    listings: RentalListingWithDelta[],
  ): RentalTopPick[] {
    return response.topPicks
      .map((pick): RentalTopPick | null => {
        const listing = this.findById(listings, pick.listingId);
        if (!listing) return null;
        return { listing, score: pick.score, reasoning: pick.reasoning };
      })
      .filter((pick): pick is RentalTopPick => pick !== null);
  }

  /** Falls back to arithmetic if the model named a listing that is not here. */
  private cheapest(
    listings: RentalListingWithDelta[],
    listingId: string,
  ): RentalListingWithDelta | null {
    const named = this.findById(listings, listingId);
    if (named) return named;
    return listings.reduce<RentalListingWithDelta | null>(
      (cheapest, listing) =>
        cheapest === null || listing.monthlyTotalBRL < cheapest.monthlyTotalBRL
          ? listing
          : cheapest,
      null,
    );
  }

  private resolveDrops(
    response: RentalAnalysisOutput,
    listings: RentalListingWithDelta[],
  ): RentalListingWithDelta[] {
    const fromModel = response.significantDropListingIds
      .map((id) => this.findById(listings, id))
      .filter((listing): listing is RentalListingWithDelta => listing !== null);

    if (fromModel.length > 0) return fromModel;

    return listings.filter(
      (listing) =>
        listing.changePercent !== null &&
        listing.changePercent <= RentalAnalysisAgent.DROP_THRESHOLD,
    );
  }

  private findById(
    listings: RentalListingWithDelta[],
    id: string,
  ): RentalListingWithDelta | null {
    return listings.find((listing) => listing.listingId === id) ?? null;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
