import type {
  IEmbeddingProvider,
  IRentalAgent,
  IRentalHistoryStore,
} from "../../../ports/index.js";
import type {
  RentalGraphState,
  RentalHistoryEntry,
  RentalListing,
  RentalListingWithDelta,
  RentalSimilarMatch,
} from "../../../../shared/models/index.js";

export interface RentalHistoryAgentOptions {
  similarLimit?: number;
  minSimilarity?: number;
  /** A monthly-cost drop of at least this much is worth reporting. */
  dropThresholdPercent?: number;
}

/**
 * Tracks the monthly total over time. In rentals this is the highest-value
 * signal in the whole pipeline: a unit that has been re-advertised for weeks and
 * keeps dropping is a landlord who will negotiate.
 */
export class RentalHistoryAgent implements IRentalAgent {
  private static readonly DEFAULT_SIMILAR_LIMIT = 5;
  private static readonly DEFAULT_MIN_SIMILARITY = 0.55;
  private static readonly DEFAULT_DROP_THRESHOLD = -3;

  constructor(
    private readonly store: IRentalHistoryStore,
    private readonly embeddings: IEmbeddingProvider,
    private readonly options: RentalHistoryAgentOptions = {},
  ) {}

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    const dbPath = this.store.resolvePath();
    console.log(`\n[RentalHistoryAgent] Updating history at ${dbPath}`);

    await this.store.ensureInitialized();
    const history = await this.store.loadHistory(state.query);
    const timestamp = new Date().toISOString();

    const listingsWithHistory = state.rawListings.map((listing) => {
      const previous = history.get(listing.listingId);
      return this.computeDelta(
        listing,
        previous?.lastMonthlyTotal ?? null,
        previous?.observationCount ?? 0,
      );
    });

    await this.store.appendEntries(
      listingsWithHistory.map((listing) =>
        this.toHistoryEntry(state.query, timestamp, listing),
      ),
    );

    await this.persistEmbeddings(listingsWithHistory);
    const similarListings = await this.findSemanticallySimilar(state);

    const threshold =
      this.options.dropThresholdPercent ??
      RentalHistoryAgent.DEFAULT_DROP_THRESHOLD;
    const drops = listingsWithHistory.filter(
      (listing) =>
        listing.changePercent !== null && listing.changePercent <= threshold,
    );

    console.log(
      `[RentalHistoryAgent] ${listingsWithHistory.length} snapshots saved · ${drops.length} drops detected.`,
    );
    if (similarListings.length > 0) {
      console.log(
        `[RentalHistoryAgent] ${similarListings.length} semantically similar past listings found.`,
      );
    }

    return { listingsWithHistory, dbPath, similarListings };
  }

  private async persistEmbeddings(
    listings: RentalListingWithDelta[],
  ): Promise<void> {
    const newRecords = listings.filter(
      (listing) => listing.observationCount === 1,
    );
    if (newRecords.length === 0) return;

    console.log(
      `[RentalHistoryAgent] Embedding ${newRecords.length} new listings via Vertex AI...`,
    );

    try {
      const vectors = await this.embeddings.embedDocuments(
        newRecords.map((listing) => this.toEmbeddingText(listing)),
      );
      for (let i = 0; i < newRecords.length; i++) {
        await this.store.upsertEmbedding(newRecords[i].listingId, vectors[i]);
      }
    } catch (error) {
      console.log(
        `[RentalHistoryAgent] Embedding generation failed (proceeding without): ${(error as Error).message}`,
      );
    }
  }

  private async findSemanticallySimilar(
    state: RentalGraphState,
  ): Promise<RentalSimilarMatch[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(state.query);
      return await this.store.findSimilar(queryEmbedding, {
        limit:
          this.options.similarLimit ?? RentalHistoryAgent.DEFAULT_SIMILAR_LIMIT,
        excludeListingIds: state.rawListings.map((l) => l.listingId),
        minSimilarity:
          this.options.minSimilarity ??
          RentalHistoryAgent.DEFAULT_MIN_SIMILARITY,
      });
    } catch (error) {
      console.log(
        `[RentalHistoryAgent] Semantic search failed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private toEmbeddingText(listing: RentalListingWithDelta): string {
    const { attributes } = listing;
    const parts: string[] = [listing.title, attributes.tipo];
    if (attributes.quartos !== null) parts.push(`${attributes.quartos} quartos`);
    if (attributes.areaM2 !== null) parts.push(`${attributes.areaM2} m2`);
    if (attributes.vagas !== null) parts.push(`${attributes.vagas} vagas`);
    if (attributes.bairro) parts.push(attributes.bairro);
    if (attributes.cidade) parts.push(attributes.cidade);
    if (attributes.mobiliado) parts.push("mobiliado");
    return parts.join(" · ");
  }

  private computeDelta(
    listing: RentalListing,
    previousMonthlyTotal: number | null,
    observationCount: number,
  ): RentalListingWithDelta {
    if (previousMonthlyTotal === null) {
      return {
        ...listing,
        previousMonthlyTotal: null,
        monthlyChange: null,
        changePercent: null,
        observationCount: 1,
      };
    }

    const monthlyChange = listing.monthlyTotalBRL - previousMonthlyTotal;
    return {
      ...listing,
      previousMonthlyTotal,
      monthlyChange,
      changePercent:
        previousMonthlyTotal > 0
          ? (monthlyChange / previousMonthlyTotal) * 100
          : 0,
      observationCount: observationCount + 1,
    };
  }

  private toHistoryEntry(
    query: string,
    timestamp: string,
    listing: RentalListingWithDelta,
  ): RentalHistoryEntry {
    const { attributes, rating } = listing;
    return {
      timestamp,
      query,
      listingId: listing.listingId,
      source: listing.source,
      title: listing.title,
      url: listing.url,
      location: listing.location,
      rentBRL: listing.rentBRL,
      condominioBRL: attributes.condominioBRL,
      iptuMensalBRL: attributes.iptuMensalBRL,
      monthlyTotalBRL: listing.monthlyTotalBRL,
      currency: listing.currency,
      tipo: attributes.tipo,
      areaM2: attributes.areaM2,
      quartos: attributes.quartos,
      suites: attributes.suites,
      banheiros: attributes.banheiros,
      vagas: attributes.vagas,
      bairro: attributes.bairro,
      cidade: attributes.cidade,
      uf: attributes.uf,
      andar: attributes.andar,
      mobiliado: attributes.mobiliado,
      aceitaPet: attributes.aceitaPet,
      previousMonthlyTotal: listing.previousMonthlyTotal,
      monthlyChange: listing.monthlyChange,
      changePercent: listing.changePercent,
      observationCount: listing.observationCount,
      rating: rating?.classification ?? null,
      fairMonthlyTotal: rating?.fairMonthlyTotalBRL ?? null,
      deltaPercent: rating ? Number(rating.deltaPercent.toFixed(2)) : null,
      pricePerM2: rating?.pricePerM2 ?? null,
      benchmarkScope: rating?.benchmark.scope ?? null,
      benchmarkLabel: rating?.benchmark.label ?? null,
      benchmarkSampleSize: rating?.benchmark.sampleSize ?? null,
      warnings:
        rating && rating.warnings.length > 0
          ? rating.warnings.join(" | ")
          : null,
      ratingReasoning: rating?.reasoning ?? null,
    };
  }
}
