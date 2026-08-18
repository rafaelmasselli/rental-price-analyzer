import Database, { type Database as DatabaseInstance } from "better-sqlite3";
import { resolve } from "node:path";
import type { IEmbeddingProvider } from "../../core/ports/index.js";
import { EmbeddingCodec } from "./EmbeddingCodec.js";

export type HistoryRating = "good_deal" | "fair" | "overpriced";

export interface HistoryQueryFilters {
  rating?: HistoryRating;
  query?: string;
  days?: number;
  minPrice?: number;
  maxPrice?: number;
  similarTo?: string;
  limit: number;
}

export interface HistoryResult {
  listingId: string;
  title: string;
  url: string;
  location: string | null;
  query: string;
  price: number;
  rating: HistoryRating | null;
  estimatedFairTotal: number | null;
  deltaPercent: number | null;
  componentsBreakdown: string | null;
  ratingReasoning: string | null;
  timestamp: string;
  similarity?: number;
}

interface SnapshotRow {
  listing_id: string;
  title: string;
  url: string;
  location: string | null;
  query: string;
  price: number;
  rating: HistoryRating | null;
  estimated_fair_total: number | null;
  delta_percent: number | null;
  components_breakdown: string | null;
  rating_reasoning: string | null;
  timestamp: string;
  embedding: Buffer | null;
}

export class HistoryQueryService {
  private readonly absolutePath: string;
  private readonly codec: EmbeddingCodec;

  constructor(
    dbPath: string,
    private readonly embeddings: IEmbeddingProvider | null = null,
    cwd: string = process.cwd(),
    codec: EmbeddingCodec = new EmbeddingCodec(),
  ) {
    this.absolutePath = resolve(cwd, dbPath);
    this.codec = codec;
  }

  async query(filters: HistoryQueryFilters): Promise<HistoryResult[]> {
    const db = new Database(this.absolutePath, { readonly: true });
    try {
      const rows = filters.similarTo
        ? await this.semanticQuery(db, filters)
        : this.recencyQuery(db, filters);
      return rows;
    } finally {
      db.close();
    }
  }

  private recencyQuery(
    db: DatabaseInstance,
    filters: HistoryQueryFilters,
  ): HistoryResult[] {
    const where: string[] = [];
    const params: Record<string, string | number> = {};

    if (filters.rating) {
      where.push("s.rating = @rating");
      params.rating = filters.rating;
    }
    if (filters.query) {
      where.push("s.query = @query");
      params.query = filters.query;
    }
    if (filters.days !== undefined) {
      where.push("s.timestamp > @sinceTimestamp");
      params.sinceTimestamp = this.daysAgoIso(filters.days);
    }
    if (filters.minPrice !== undefined) {
      where.push("s.price >= @minPrice");
      params.minPrice = filters.minPrice;
    }
    if (filters.maxPrice !== undefined) {
      where.push("s.price <= @maxPrice");
      params.maxPrice = filters.maxPrice;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        s.listing_id, l.title, l.url, l.location,
        s.query, s.price, s.rating, s.estimated_fair_total,
        s.delta_percent, s.components_breakdown, s.rating_reasoning,
        s.timestamp
      FROM snapshots s
      JOIN listings l ON l.listing_id = s.listing_id
      ${whereClause}
      ORDER BY s.timestamp DESC
      LIMIT @limit
    `;

    const rows = db
      .prepare(sql)
      .all({ ...params, limit: filters.limit }) as Omit<SnapshotRow, "embedding">[];

    return rows.map((row) => this.toResult(row));
  }

  private async semanticQuery(
    db: DatabaseInstance,
    filters: HistoryQueryFilters,
  ): Promise<HistoryResult[]> {
    if (!this.embeddings) {
      throw new Error(
        "Semantic search requires an embedding provider. Pass one to HistoryQueryService.",
      );
    }
    if (!filters.similarTo) return [];

    const queryEmbedding = await this.embeddings.embedQuery(filters.similarTo);

    const where: string[] = ["l.embedding IS NOT NULL"];
    const params: Record<string, string | number> = {};

    if (filters.rating) {
      where.push("s.rating = @rating");
      params.rating = filters.rating;
    }
    if (filters.query) {
      where.push("s.query = @query");
      params.query = filters.query;
    }
    if (filters.days !== undefined) {
      where.push("s.timestamp > @sinceTimestamp");
      params.sinceTimestamp = this.daysAgoIso(filters.days);
    }
    if (filters.minPrice !== undefined) {
      where.push("s.price >= @minPrice");
      params.minPrice = filters.minPrice;
    }
    if (filters.maxPrice !== undefined) {
      where.push("s.price <= @maxPrice");
      params.maxPrice = filters.maxPrice;
    }

    const sql = `
      SELECT
        s.listing_id, l.title, l.url, l.location, l.embedding,
        s.query, s.price, s.rating, s.estimated_fair_total,
        s.delta_percent, s.components_breakdown, s.rating_reasoning,
        s.timestamp
      FROM snapshots s
      JOIN listings l ON l.listing_id = s.listing_id
      WHERE ${where.join(" AND ")}
      AND s.timestamp = (
        SELECT MAX(s2.timestamp) FROM snapshots s2
        WHERE s2.listing_id = s.listing_id
      )
    `;

    const rows = db.prepare(sql).all(params) as SnapshotRow[];

    const scored = rows.map((row) => {
      const vector = this.codec.decode(row.embedding!);
      const similarity = this.codec.cosineSimilarity(queryEmbedding, vector);
      return { row, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored
      .slice(0, filters.limit)
      .map(({ row, similarity }) => ({ ...this.toResult(row), similarity }));
  }

  private toResult(row: Omit<SnapshotRow, "embedding">): HistoryResult {
    return {
      listingId: row.listing_id,
      title: row.title,
      url: row.url,
      location: row.location,
      query: row.query,
      price: row.price,
      rating: row.rating,
      estimatedFairTotal: row.estimated_fair_total,
      deltaPercent: row.delta_percent,
      componentsBreakdown: row.components_breakdown,
      ratingReasoning: row.rating_reasoning,
      timestamp: row.timestamp,
    };
  }

  private daysAgoIso(days: number): string {
    const now = Date.now();
    const since = now - days * 24 * 60 * 60 * 1000;
    return new Date(since).toISOString();
  }
}
