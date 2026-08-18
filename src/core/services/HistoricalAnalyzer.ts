import type { ILLMProvider } from "../ports/index.js";
import type {
  HistoryQueryFilters,
  HistoryQueryService,
  HistoryRating,
  HistoryResult,
} from "../../infra/storage/index.js";
import { historicalAnalysisPrompt } from "./historicalAnalysisPrompt.js";
import {
  historicalAnalysisSchema,
  type HistoricalAnalysisOutput,
} from "./historicalAnalysisSchema.js";

export interface AnalyzedTopPick {
  listing: HistoryResult;
  score: number;
  reasoning: string;
}

export interface HistoricalStats {
  totalListings: number;
  byRating: Record<HistoryRating | "unrated", number>;
  priceMin: number;
  priceMax: number;
  priceMedian: number;
  priceMean: number;
  averageDeltaPercent: number;
}

export interface HistoricalAnalysisResult {
  filters: HistoryQueryFilters;
  stats: HistoricalStats;
  topPicks: AnalyzedTopPick[];
  marketPatterns: string;
  componentObservations: string;
  buyOrWait: string;
}

export class HistoricalAnalyzer {
  constructor(
    private readonly llmProvider: ILLMProvider,
    private readonly queryService: HistoryQueryService,
  ) {}

  async analyze(
    filters: HistoryQueryFilters,
  ): Promise<HistoricalAnalysisResult | null> {
    const rawResults = await this.queryService.query(filters);
    const uniqueResults = this.dedupeByListingId(rawResults);

    if (uniqueResults.length === 0) {
      return null;
    }

    const stats = this.computeStats(uniqueResults);
    const llmResponse = await this.runLlmAnalysis(stats, uniqueResults);

    return {
      filters,
      stats,
      topPicks: this.resolveTopPicks(llmResponse.topPicks, uniqueResults),
      marketPatterns: llmResponse.marketPatterns,
      componentObservations: llmResponse.componentObservations,
      buyOrWait: llmResponse.buyOrWait,
    };
  }

  private dedupeByListingId(results: HistoryResult[]): HistoryResult[] {
    const seen = new Set<string>();
    const unique: HistoryResult[] = [];
    for (const result of results) {
      if (seen.has(result.listingId)) continue;
      seen.add(result.listingId);
      unique.push(result);
    }
    return unique;
  }

  private computeStats(results: HistoryResult[]): HistoricalStats {
    const prices = results.map((r) => r.price);
    const deltas = results
      .map((r) => r.deltaPercent)
      .filter((d): d is number => d !== null);

    const byRating: HistoricalStats["byRating"] = {
      good_deal: 0,
      fair: 0,
      overpriced: 0,
      unrated: 0,
    };
    for (const result of results) {
      const key = (result.rating ?? "unrated") as keyof typeof byRating;
      byRating[key] = (byRating[key] ?? 0) + 1;
    }

    return {
      totalListings: results.length,
      byRating,
      priceMin: Math.min(...prices),
      priceMax: Math.max(...prices),
      priceMedian: this.median(prices),
      priceMean: this.mean(prices),
      averageDeltaPercent: deltas.length > 0 ? this.mean(deltas) : 0,
    };
  }

  private async runLlmAnalysis(
    stats: HistoricalStats,
    results: HistoryResult[],
  ): Promise<HistoricalAnalysisOutput> {
    const chain = historicalAnalysisPrompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(historicalAnalysisSchema),
    );

    const payload = results.map((r) => ({
      listingId: r.listingId,
      title: r.title,
      query: r.query,
      price: r.price,
      rating: r.rating,
      deltaPercent: r.deltaPercent,
      estimatedFairTotal: r.estimatedFairTotal,
      componentsBreakdown: r.componentsBreakdown,
      ratingReasoning: r.ratingReasoning,
      seenAt: r.timestamp,
      location: r.location,
    }));

    return (await chain.invoke({
      stats: JSON.stringify(stats, null, 2),
      listings: JSON.stringify(payload, null, 2),
    })) as HistoricalAnalysisOutput;
  }

  private resolveTopPicks(
    picks: HistoricalAnalysisOutput["topPicks"],
    results: HistoryResult[],
  ): AnalyzedTopPick[] {
    const byId = new Map(results.map((r) => [r.listingId, r]));
    return picks
      .map((pick) => {
        const listing = byId.get(pick.listingId);
        if (!listing) return null;
        return {
          listing,
          score: pick.score,
          reasoning: pick.reasoning,
        };
      })
      .filter((p): p is AnalyzedTopPick => p !== null);
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
