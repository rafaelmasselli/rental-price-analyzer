import Database, { type Database as DatabaseInstance } from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  IPriceHistoryStore,
  ListingHistorySummary,
  SemanticSearchOptions,
  SimilarMatch,
} from "../../core/ports/index.js";
import type { PriceHistoryEntry } from "../../shared/models/index.js";
import { EmbeddingCodec } from "./EmbeddingCodec.js";

interface SnapshotRow {
  listing_id: string;
  price: number;
  timestamp: string;
}

interface SimilarRow {
  listing_id: string;
  title: string;
  url: string;
  query: string;
  embedding: Buffer;
  last_price: number;
  last_seen_at: string;
  rating: string | null;
}

export class SqlitePriceHistoryStore implements IPriceHistoryStore {
  private readonly absolutePath: string;
  private readonly codec: EmbeddingCodec;
  private db: DatabaseInstance | null = null;
  private initialized = false;

  constructor(
    dbPath: string = "data/history.sqlite",
    cwd: string = process.cwd(),
    codec: EmbeddingCodec = new EmbeddingCodec(),
  ) {
    this.absolutePath = resolve(cwd, dbPath);
    this.codec = codec;
  }

  resolvePath(_query: string): string {
    return this.absolutePath;
  }

  async ensureInitialized(_query: string): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.absolutePath), { recursive: true });
    this.db = new Database(this.absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.applySchema();
    this.initialized = true;
  }

  async loadHistory(query: string): Promise<Map<string, ListingHistorySummary>> {
    this.assertReady();
    const rows = this.db!
      .prepare(
        `SELECT listing_id, price, timestamp
         FROM snapshots
         WHERE query = ?
         ORDER BY timestamp ASC`,
      )
      .all(query) as SnapshotRow[];

    const map = new Map<string, ListingHistorySummary>();
    for (const row of rows) {
      const existing = map.get(row.listing_id);
      if (existing) {
        existing.lastPrice = row.price;
        existing.lastSeenAt = row.timestamp;
        existing.observationCount += 1;
      } else {
        map.set(row.listing_id, {
          lastPrice: row.price,
          observationCount: 1,
          firstSeenAt: row.timestamp,
          lastSeenAt: row.timestamp,
        });
      }
    }
    return map;
  }

  async appendEntries(
    _query: string,
    entries: PriceHistoryEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    this.assertReady();

    const upsertListing = this.db!.prepare(
      `INSERT INTO listings (listing_id, title, url, location, query, first_seen_at, last_seen_at)
       VALUES (@listing_id, @title, @url, @location, @query, @timestamp, @timestamp)
       ON CONFLICT(listing_id) DO UPDATE SET
         title = excluded.title,
         url = excluded.url,
         location = excluded.location,
         last_seen_at = excluded.last_seen_at`,
    );

    const insertSnapshot = this.db!.prepare(
      `INSERT INTO snapshots (
         listing_id, query, price, currency, previous_price, price_change,
         change_percent, observation_count, rating, estimated_fair_total,
         delta_percent, components_breakdown, missing_components,
         rating_reasoning, timestamp
       ) VALUES (
         @listing_id, @query, @price, @currency, @previous_price, @price_change,
         @change_percent, @observation_count, @rating, @estimated_fair_total,
         @delta_percent, @components_breakdown, @missing_components,
         @rating_reasoning, @timestamp
       )`,
    );

    const tx = this.db!.transaction((batch: PriceHistoryEntry[]) => {
      for (const entry of batch) {
        upsertListing.run({
          listing_id: entry.listingId,
          title: entry.title,
          url: entry.url,
          location: entry.location,
          query: entry.query,
          timestamp: entry.timestamp,
        });

        insertSnapshot.run({
          listing_id: entry.listingId,
          query: entry.query,
          price: entry.price,
          currency: entry.currency,
          previous_price: entry.previousPrice,
          price_change: entry.priceChange,
          change_percent: entry.changePercent,
          observation_count: entry.observationCount,
          rating: entry.rating,
          estimated_fair_total: entry.estimatedFairTotal,
          delta_percent: entry.deltaPercent,
          components_breakdown: entry.componentsBreakdown,
          missing_components: entry.missingComponents,
          rating_reasoning: entry.ratingReasoning,
          timestamp: entry.timestamp,
        });
      }
    });

    tx(entries);
  }

  async upsertEmbedding(listingId: string, embedding: number[]): Promise<void> {
    this.assertReady();
    const buffer = this.codec.encode(embedding);
    this.db!
      .prepare(`UPDATE listings SET embedding = ? WHERE listing_id = ?`)
      .run(buffer, listingId);
  }

  async findSimilar(
    embedding: number[],
    options: SemanticSearchOptions,
  ): Promise<SimilarMatch[]> {
    this.assertReady();

    const rows = this.db!
      .prepare(
        `SELECT
           l.listing_id,
           l.title,
           l.url,
           l.query,
           l.embedding,
           l.last_seen_at,
           (SELECT price FROM snapshots WHERE listing_id = l.listing_id ORDER BY timestamp DESC LIMIT 1) as last_price,
           (SELECT rating FROM snapshots WHERE listing_id = l.listing_id ORDER BY timestamp DESC LIMIT 1) as rating
         FROM listings l
         WHERE l.embedding IS NOT NULL`,
      )
      .all() as SimilarRow[];

    const excludeSet = new Set(options.excludeListingIds ?? []);
    const scored: SimilarMatch[] = [];

    for (const row of rows) {
      if (excludeSet.has(row.listing_id)) continue;
      if (row.last_price === null || row.last_price === undefined) continue;

      const vector = this.codec.decode(row.embedding);
      const similarity = this.codec.cosineSimilarity(embedding, vector);
      if (options.minSimilarity && similarity < options.minSimilarity) continue;

      scored.push({
        listingId: row.listing_id,
        title: row.title,
        url: row.url,
        query: row.query,
        similarity,
        lastPrice: row.last_price,
        lastSeenAt: row.last_seen_at,
        rating: row.rating,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, options.limit);
  }

  private applySchema(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        listing_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        location TEXT,
        query TEXT NOT NULL,
        embedding BLOB,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id TEXT NOT NULL,
        query TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL,
        previous_price REAL,
        price_change REAL,
        change_percent REAL,
        observation_count INTEGER NOT NULL,
        rating TEXT,
        estimated_fair_total REAL,
        delta_percent REAL,
        components_breakdown TEXT,
        missing_components TEXT,
        rating_reasoning TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (listing_id) REFERENCES listings(listing_id)
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_listing ON snapshots(listing_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);
      CREATE INDEX IF NOT EXISTS idx_snapshots_query ON snapshots(query);
    `);
  }

  private assertReady(): void {
    if (!this.db) {
      throw new Error("SqlitePriceHistoryStore not initialized. Call ensureInitialized() first.");
    }
  }
}
