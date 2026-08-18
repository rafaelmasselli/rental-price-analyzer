import type {
  ComponentPriceQuote,
  IAgent,
  IComponentPriceLookup,
  ILLMProvider,
} from "../../ports/index.js";
import type {
  GraphState,
  Listing,
  ListingComponent,
  ListingRating,
} from "../../../shared/models/index.js";
import { ratingPrompt } from "./prompt.js";
import { ratingSchema, type RatingSchemaOutput } from "./schema.js";

type Extraction = RatingSchemaOutput["ratings"][number];
type ExtractedComponent = Extraction["components"][number];

interface RunSummary {
  good: number;
  fair: number;
  overpriced: number;
  irrelevant: number;
  unrated: number;
  sourceMl: number;
  sourceLlm: number;
}

export class RatingAgent implements IAgent {
  private static readonly MIN_RELIABLE_SAMPLE = 3;
  private static readonly BATCH_SIZE = 20;
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly INITIAL_BACKOFF_MS = 2000;

  constructor(
    private readonly llmProvider: ILLMProvider,
    private readonly priceLookup: IComponentPriceLookup,
  ) {}

  async run(state: GraphState): Promise<Partial<GraphState>> {
    if (state.rawListings.length === 0) {
      return { rawListings: [] };
    }

    console.log(
      `\n[RatingAgent] Step 1: extracting components from ${state.rawListings.length} listings (LLM also estimates prices as fallback)...`,
    );
    const extractions = await this.extractInBatches(state);

    console.log(`[RatingAgent] Step 2: validating prices against Mercado Livre...`);
    const priceMap = await this.lookupAllPrices(extractions);
    const mlHits = Array.from(priceMap.values()).filter((q) => q !== null).length;
    console.log(
      `[RatingAgent] Mercado Livre returned ${mlHits}/${priceMap.size} reliable quotes; rest will fall back to LLM estimates.`,
    );

    const summary: RunSummary = {
      good: 0,
      fair: 0,
      overpriced: 0,
      irrelevant: 0,
      unrated: 0,
      sourceMl: 0,
      sourceLlm: 0,
    };
    const kept: Listing[] = [];

    for (const listing of state.rawListings) {
      const extraction = extractions.get(listing.listingId);

      if (extraction?.classification === "irrelevant") {
        summary.irrelevant += 1;
        continue;
      }

      if (!extraction) {
        summary.unrated += 1;
        kept.push(listing);
        continue;
      }

      const rating = this.buildRating(listing, extraction, priceMap, summary);
      if (!rating) {
        summary.unrated += 1;
        kept.push(listing);
        continue;
      }

      this.tallyClassification(summary, rating.classification);
      kept.push({ ...listing, rating });
    }

    console.log(
      `[RatingAgent] good_deal: ${summary.good} · fair: ${summary.fair} · overpriced: ${summary.overpriced} · irrelevant (dropped): ${summary.irrelevant} · unrated (kept anyway): ${summary.unrated}`,
    );
    console.log(
      `[RatingAgent] Price source totals: mercadolivre=${summary.sourceMl} · llm_estimate=${summary.sourceLlm}`,
    );

    return { rawListings: kept };
  }

  private async extractInBatches(
    state: GraphState,
  ): Promise<Map<string, Extraction>> {
    const batches = this.chunk(state.rawListings, RatingAgent.BATCH_SIZE);
    console.log(
      `[RatingAgent] Processing in ${batches.length} batch(es) of up to ${RatingAgent.BATCH_SIZE} listings...`,
    );

    const all = new Map<string, Extraction>();
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(
        `[RatingAgent] Batch ${i + 1}/${batches.length} (${batch.length} listings)...`,
      );
      const result = await this.extractBatchWithRetry(state, batch);
      for (const [id, extraction] of result) {
        all.set(id, extraction);
      }
    }

    return all;
  }

  private async extractBatchWithRetry(
    state: GraphState,
    batch: Listing[],
  ): Promise<Map<string, Extraction>> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RatingAgent.MAX_ATTEMPTS; attempt++) {
      try {
        return await this.extractBatch(state, batch);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        console.log(
          `[RatingAgent] Attempt ${attempt}/${RatingAgent.MAX_ATTEMPTS} failed: ${message}`,
        );
        if (attempt < RatingAgent.MAX_ATTEMPTS) {
          const backoff =
            RatingAgent.INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.log(`[RatingAgent] Retrying in ${backoff}ms...`);
          await this.sleep(backoff);
        }
      }
    }

    const finalMessage =
      lastError instanceof Error ? lastError.message : String(lastError);
    console.log(
      `[RatingAgent] Batch failed permanently after ${RatingAgent.MAX_ATTEMPTS} attempts (${finalMessage}). Listings will pass through unrated.`,
    );
    return new Map();
  }

  private async extractBatch(
    state: GraphState,
    batch: Listing[],
  ): Promise<Map<string, Extraction>> {
    const chain = ratingPrompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(ratingSchema),
    );

    const payload = batch.map((listing) => ({
      listingId: listing.listingId,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      location: listing.location,
      category: listing.category,
    }));

    const response = (await chain.invoke({
      query: state.query,
      variations: state.expandedQueries.join(" | "),
      listings: JSON.stringify(payload, null, 2),
    })) as RatingSchemaOutput;

    const byId = new Map<string, Extraction>();
    for (const item of response.ratings) {
      byId.set(item.listingId, item);
    }
    return byId;
  }

  private async lookupAllPrices(
    extractions: Map<string, Extraction>,
  ): Promise<Map<string, ComponentPriceQuote | null>> {
    const uniqueSpecs = new Map<string, { spec: string; category: string }>();
    for (const extraction of extractions.values()) {
      if (extraction.classification !== "valid") continue;
      for (const component of extraction.components) {
        const key = this.specKey(component.spec);
        if (!uniqueSpecs.has(key)) {
          uniqueSpecs.set(key, {
            spec: component.spec,
            category: component.category,
          });
        }
      }
    }

    const results = new Map<string, ComponentPriceQuote | null>();
    for (const [key, { spec, category }] of uniqueSpecs.entries()) {
      try {
        const quote = await this.priceLookup.lookup(spec, category);
        results.set(key, quote);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[RatingAgent] Lookup for "${spec}" threw: ${message}`);
        results.set(key, null);
      }
    }

    return results;
  }

  private buildRating(
    listing: Listing,
    extraction: Extraction,
    priceMap: Map<string, ComponentPriceQuote | null>,
    summary: { sourceMl: number; sourceLlm: number },
  ): ListingRating | null {
    const components = extraction.components.map((component) =>
      this.resolveComponent(component, priceMap, summary),
    );

    const pricedComponents = components.filter(
      (component) => component.estimatedPriceBRL !== null,
    );

    if (pricedComponents.length === 0) {
      return null;
    }

    const estimatedFairTotalBRL = pricedComponents.reduce(
      (sum, component) => sum + (component.estimatedPriceBRL ?? 0),
      0,
    );

    const deltaPercent =
      estimatedFairTotalBRL > 0
        ? ((listing.price - estimatedFairTotalBRL) / estimatedFairTotalBRL) * 100
        : 0;

    return {
      classification: this.classifyFromDelta(deltaPercent),
      components,
      estimatedFairTotalBRL: Math.round(estimatedFairTotalBRL),
      deltaPercent: Number(deltaPercent.toFixed(2)),
      missingStandardComponents: extraction.missingStandardComponents,
      reasoning: this.buildReasoning(
        listing.price,
        estimatedFairTotalBRL,
        deltaPercent,
        components,
      ),
    };
  }

  private resolveComponent(
    extracted: ExtractedComponent,
    priceMap: Map<string, ComponentPriceQuote | null>,
    summary: { sourceMl: number; sourceLlm: number },
  ): ListingComponent {
    const mlQuote = priceMap.get(this.specKey(extracted.spec));
    const mlReliable =
      mlQuote !== undefined &&
      mlQuote !== null &&
      mlQuote.sampleSize >= RatingAgent.MIN_RELIABLE_SAMPLE;

    if (mlReliable) {
      summary.sourceMl += 1;
      return {
        category: extracted.category,
        spec: extracted.spec,
        estimatedPriceBRL: mlQuote.medianPriceBRL,
        priceSource: "mercadolivre",
        marketSampleSize: mlQuote.sampleSize,
        marketSourceUrl: mlQuote.sourceUrl,
      };
    }

    if (extracted.approximatePriceBRL > 0) {
      summary.sourceLlm += 1;
      return {
        category: extracted.category,
        spec: extracted.spec,
        estimatedPriceBRL: Math.round(extracted.approximatePriceBRL),
        priceSource: "llm_estimate",
        marketSampleSize: 0,
        marketSourceUrl: null,
      };
    }

    return {
      category: extracted.category,
      spec: extracted.spec,
      estimatedPriceBRL: null,
      priceSource: "none",
      marketSampleSize: 0,
      marketSourceUrl: null,
    };
  }

  private classifyFromDelta(
    deltaPercent: number,
  ): ListingRating["classification"] {
    if (deltaPercent <= -15) return "good_deal";
    if (deltaPercent >= 15) return "overpriced";
    return "fair";
  }

  private buildReasoning(
    listingPrice: number,
    fairTotal: number,
    deltaPercent: number,
    components: ListingComponent[],
  ): string {
    const partsLine = components
      .map((component) => {
        const source =
          component.priceSource === "mercadolivre"
            ? "ml"
            : component.priceSource === "llm_estimate"
              ? "llm"
              : "?";
        return component.estimatedPriceBRL !== null
          ? `${component.category}[${source}] R$${component.estimatedPriceBRL}`
          : `${component.category} ?`;
      })
      .join(" + ");
    const sign = deltaPercent > 0 ? "+" : "";
    return `${partsLine} = R$${Math.round(fairTotal)} fair vs R$${listingPrice} asking → ${sign}${deltaPercent.toFixed(1)}%`;
  }

  private tallyClassification(
    summary: { good: number; fair: number; overpriced: number },
    classification: ListingRating["classification"],
  ): void {
    if (classification === "good_deal") summary.good += 1;
    else if (classification === "fair") summary.fair += 1;
    else summary.overpriced += 1;
  }

  private specKey(spec: string): string {
    return spec.toLowerCase().trim().replace(/\s+/g, " ");
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      result.push(items.slice(i, i + size));
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
