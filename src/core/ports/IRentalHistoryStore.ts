import type {
  RentalHistoryEntry,
  RentalSimilarMatch,
} from "../../shared/models/index.js";
import type { CompRecord } from "./IRentBenchmarkLookup.js";
import type { SemanticSearchOptions } from "./IPriceHistoryStore.js";

export interface RentalHistorySummary {
  lastMonthlyTotal: number;
  observationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface IRentalHistoryStore {
  resolvePath(): string;
  ensureInitialized(): Promise<void>;
  loadHistory(query: string): Promise<Map<string, RentalHistorySummary>>;
  /** Comparables observed in the last `windowDays` days, one row per listing. */
  loadComps(windowDays: number): Promise<CompRecord[]>;
  appendEntries(entries: RentalHistoryEntry[]): Promise<void>;
  /** Refuses to mix vectors from different embedding models. */
  assertEmbeddingCompatible(model: string, dimensions: number): void;
  upsertEmbedding(listingId: string, embedding: number[]): Promise<void>;
  findSimilar(
    embedding: number[],
    options: SemanticSearchOptions,
  ): Promise<RentalSimilarMatch[]>;
}
