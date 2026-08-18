import type {
  IAgent,
  IEmbeddingProvider,
  IPriceHistoryStore,
  SimilarMatch,
} from "../../ports/index.js";
import type {
  GraphState,
  Listing,
  ListingRating,
  ListingWithDelta,
  PriceHistoryEntry,
} from "../../../shared/models/index.js";

export interface HistoryAgentOptions {
  similarLimit?: number;
  minSimilarity?: number;
}

export class HistoryAgent implements IAgent {
  private static readonly DEFAULT_SIMILAR_LIMIT = 5;
  private static readonly DEFAULT_MIN_SIMILARITY = 0.55;

  constructor(
    private readonly store: IPriceHistoryStore,
    private readonly embeddings: IEmbeddingProvider,
    private readonly options: HistoryAgentOptions = {},
  ) {}

  async run(state: GraphState): Promise<Partial<GraphState>> {
    const dbPath = this.store.resolvePath(state.query);
    console.log(`\n[HistoryAgent] Updating history at ${dbPath}`);

    await this.store.ensureInitialized(state.query);
    const history = await this.store.loadHistory(state.query);
    const timestamp = new Date().toISOString();

    const listingsWithHistory = state.rawListings.map((listing) => {
      const previous = history.get(listing.listingId);
      return this.computeDelta(
        listing,
        previous?.lastPrice ?? null,
        previous?.observationCount ?? 0,
      );
    });

    const entries = listingsWithHistory.map((listing) =>
      this.toHistoryEntry(state.query, timestamp, listing),
    );
    await this.store.appendEntries(state.query, entries);

    await this.persistEmbeddings(listingsWithHistory);

    const similarListings = await this.findSemanticallySimilar(state);

    const drops = listingsWithHistory.filter(
      (l) => l.changePercent !== null && l.changePercent <= -3,
    );
    console.log(
      `[HistoryAgent] ${entries.length} snapshots saved · ${drops.length} drops detected.`,
    );
    if (similarListings.length > 0) {
      console.log(
        `[HistoryAgent] ${similarListings.length} semantically similar past listings found.`,
      );
    }

    return { listingsWithHistory, csvPath: dbPath, similarListings };
  }

  private async persistEmbeddings(
    listings: ListingWithDelta[],
  ): Promise<void> {
    if (listings.length === 0) return;
    const newRecords = listings.filter((l) => l.observationCount === 1);
    if (newRecords.length === 0) return;

    const texts = newRecords.map((listing) => this.toEmbeddingText(listing));
    console.log(
      `[HistoryAgent] Embedding ${newRecords.length} new listings via Vertex AI...`,
    );

    try {
      const vectors = await this.embeddings.embedDocuments(texts);
      for (let i = 0; i < newRecords.length; i++) {
        await this.store.upsertEmbedding(newRecords[i].listingId, vectors[i]);
      }
    } catch (error) {
      console.log(
        `[HistoryAgent] Embedding generation failed (proceeding without): ${(error as Error).message}`,
      );
    }
  }

  private async findSemanticallySimilar(
    state: GraphState,
  ): Promise<SimilarMatch[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(state.query);
      const excludeIds = state.rawListings.map((l) => l.listingId);
      return await this.store.findSimilar(queryEmbedding, {
        limit: this.options.similarLimit ?? HistoryAgent.DEFAULT_SIMILAR_LIMIT,
        excludeListingIds: excludeIds,
        minSimilarity:
          this.options.minSimilarity ?? HistoryAgent.DEFAULT_MIN_SIMILARITY,
      });
    } catch (error) {
      console.log(
        `[HistoryAgent] Semantic search failed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private toEmbeddingText(listing: ListingWithDelta): string {
    const parts: string[] = [listing.title];
    if (listing.category) parts.push(listing.category);
    if (listing.rating?.components.length) {
      parts.push(listing.rating.components.map((c) => `${c.category}:${c.spec}`).join(" | "));
    }
    return parts.join(" · ");
  }

  private computeDelta(
    listing: Listing,
    previousPrice: number | null,
    observationCount: number,
  ): ListingWithDelta {
    if (previousPrice === null) {
      return {
        ...listing,
        previousPrice: null,
        priceChange: null,
        changePercent: null,
        observationCount: 1,
      };
    }

    const priceChange = listing.price - previousPrice;
    const changePercent =
      previousPrice > 0 ? (priceChange / previousPrice) * 100 : 0;

    return {
      ...listing,
      previousPrice,
      priceChange,
      changePercent,
      observationCount: observationCount + 1,
    };
  }

  private toHistoryEntry(
    query: string,
    timestamp: string,
    listing: ListingWithDelta,
  ): PriceHistoryEntry {
    const rating = listing.rating;
    return {
      timestamp,
      query,
      listingId: listing.listingId,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      location: listing.location,
      url: listing.url,
      previousPrice: listing.previousPrice,
      priceChange: listing.priceChange,
      changePercent: listing.changePercent,
      observationCount: listing.observationCount,
      rating: rating?.classification ?? null,
      estimatedFairTotal: rating?.estimatedFairTotalBRL ?? null,
      deltaPercent: rating ? Number(rating.deltaPercent.toFixed(2)) : null,
      componentsBreakdown: rating ? this.formatComponents(rating) : null,
      missingComponents: this.formatMissing(rating),
      ratingReasoning: rating?.reasoning ?? null,
    };
  }

  private formatComponents(rating: ListingRating): string {
    return rating.components
      .map((c) => `${c.category}:${c.spec}≈R$${c.estimatedPriceBRL ?? "?"}`)
      .join(" | ");
  }

  private formatMissing(rating?: ListingRating): string | null {
    if (!rating || rating.missingStandardComponents.length === 0) return null;
    return rating.missingStandardComponents.join(", ");
  }
}
