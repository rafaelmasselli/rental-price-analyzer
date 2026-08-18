import type { PriceHistoryEntry } from "../../shared/models/index.js";

export interface ListingHistorySummary {
  lastPrice: number;
  observationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SimilarMatch {
  listingId: string;
  title: string;
  url: string;
  query: string;
  similarity: number;
  lastPrice: number;
  lastSeenAt: string;
  rating: string | null;
}

export interface SemanticSearchOptions {
  limit: number;
  excludeListingIds?: string[];
  minSimilarity?: number;
}

export interface IPriceHistoryStore {
  resolvePath(query: string): string;
  ensureInitialized(query: string): Promise<void>;
  loadHistory(query: string): Promise<Map<string, ListingHistorySummary>>;
  appendEntries(query: string, entries: PriceHistoryEntry[]): Promise<void>;
  upsertEmbedding(listingId: string, embedding: number[]): Promise<void>;
  findSimilar(
    embedding: number[],
    options: SemanticSearchOptions,
  ): Promise<SimilarMatch[]>;
}
