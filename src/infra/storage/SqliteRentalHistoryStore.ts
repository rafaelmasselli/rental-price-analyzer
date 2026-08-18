import Database, { type Database as DatabaseInstance } from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  CompRecord,
  IRentalHistoryStore,
  RentalHistorySummary,
  SemanticSearchOptions,
} from "../../core/ports/index.js";
import type {
  RentalHistoryEntry,
  RentalSimilarMatch,
} from "../../shared/models/index.js";
import { EmbeddingCodec } from "./EmbeddingCodec.js";

interface SnapshotRow {
  listing_id: string;
  monthly_total: number;
  timestamp: string;
}

interface CompRow {
  cidade: string | null;
  bairro: string | null;
  quartos: number | null;
  tipo: string;
  area_m2: number | null;
  monthly_total: number;
}

interface SimilarRow {
  listing_id: string;
  title: string;
  url: string;
  query: string;
  embedding: Buffer;
  last_monthly_total: number | null;
  last_seen_at: string;
  rating: string | null;
}

export class SqliteRentalHistoryStore implements IRentalHistoryStore {
  private readonly absolutePath: string;
  private readonly codec: EmbeddingCodec;
  private db: DatabaseInstance | null = null;
  private initialized = false;

  constructor(
    dbPath: string = "data/rentals.sqlite",
    cwd: string = process.cwd(),
    codec: EmbeddingCodec = new EmbeddingCodec(),
  ) {
    this.absolutePath = resolve(cwd, dbPath);
    this.codec = codec;
  }

  resolvePath(): string {
    return this.absolutePath;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.absolutePath), { recursive: true });
    this.db = new Database(this.absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.applySchema();
    this.initialized = true;
  }

  async loadHistory(
    query: string,
  ): Promise<Map<string, RentalHistorySummary>> {
    this.assertReady();
    const rows = this.db!
      .prepare(
        `SELECT listing_id, monthly_total, timestamp
         FROM rental_snapshots
         WHERE query = ?
         ORDER BY timestamp ASC`,
      )
      .all(query) as SnapshotRow[];

    const map = new Map<string, RentalHistorySummary>();
    for (const row of rows) {
      const existing = map.get(row.listing_id);
      if (existing) {
        existing.lastMonthlyTotal = row.monthly_total;
        existing.lastSeenAt = row.timestamp;
        existing.observationCount += 1;
      } else {
        map.set(row.listing_id, {
          lastMonthlyTotal: row.monthly_total,
          observationCount: 1,
          firstSeenAt: row.timestamp,
          lastSeenAt: row.timestamp,
        });
      }
    }
    return map;
  }

  /**
   * One row per listing (its most recent observation) inside the window.
   * Older snapshots of the same unit would bias the median toward whatever
   * was scraped most often.
   */
  async loadComps(windowDays: number): Promise<CompRecord[]> {
    this.assertReady();
    const cutoff = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const rows = this.db!
      .prepare(
        `SELECT s.cidade, s.bairro, s.quartos, s.tipo, s.area_m2, s.monthly_total
         FROM rental_snapshots s
         INNER JOIN (
           SELECT listing_id, MAX(timestamp) AS max_ts
           FROM rental_snapshots
           WHERE timestamp >= ?
           GROUP BY listing_id
         ) latest
           ON latest.listing_id = s.listing_id AND latest.max_ts = s.timestamp`,
      )
      .all(cutoff) as CompRow[];

    return rows.map((row) => ({
      cidade: row.cidade,
      bairro: row.bairro,
      quartos: row.quartos,
      tipo: row.tipo,
      areaM2: row.area_m2,
      monthlyTotalBRL: row.monthly_total,
    }));
  }

  async appendEntries(entries: RentalHistoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    this.assertReady();

    const upsertListing = this.db!.prepare(
      `INSERT INTO rental_listings (
         listing_id, source, title, url, location, query, first_seen_at, last_seen_at
       ) VALUES (
         @listing_id, @source, @title, @url, @location, @query, @timestamp, @timestamp
       )
       ON CONFLICT(listing_id) DO UPDATE SET
         title = excluded.title,
         url = excluded.url,
         location = excluded.location,
         last_seen_at = excluded.last_seen_at`,
    );

    const insertSnapshot = this.db!.prepare(
      `INSERT INTO rental_snapshots (
         listing_id, query, source, rent_brl, condominio_brl, iptu_mensal_brl,
         monthly_total, currency, tipo, area_m2, quartos, suites, banheiros,
         vagas, bairro, cidade, uf, andar, mobiliado, aceita_pet,
         previous_monthly_total, monthly_change, change_percent,
         observation_count, rating, fair_monthly_total, delta_percent,
         price_per_m2, benchmark_scope, benchmark_label, benchmark_sample_size,
         warnings, rating_reasoning, timestamp
       ) VALUES (
         @listing_id, @query, @source, @rent_brl, @condominio_brl, @iptu_mensal_brl,
         @monthly_total, @currency, @tipo, @area_m2, @quartos, @suites, @banheiros,
         @vagas, @bairro, @cidade, @uf, @andar, @mobiliado, @aceita_pet,
         @previous_monthly_total, @monthly_change, @change_percent,
         @observation_count, @rating, @fair_monthly_total, @delta_percent,
         @price_per_m2, @benchmark_scope, @benchmark_label, @benchmark_sample_size,
         @warnings, @rating_reasoning, @timestamp
       )`,
    );

    const tx = this.db!.transaction((batch: RentalHistoryEntry[]) => {
      for (const entry of batch) {
        upsertListing.run({
          listing_id: entry.listingId,
          source: entry.source,
          title: entry.title,
          url: entry.url,
          location: entry.location,
          query: entry.query,
          timestamp: entry.timestamp,
        });

        insertSnapshot.run({
          listing_id: entry.listingId,
          query: entry.query,
          source: entry.source,
          rent_brl: entry.rentBRL,
          condominio_brl: entry.condominioBRL,
          iptu_mensal_brl: entry.iptuMensalBRL,
          monthly_total: entry.monthlyTotalBRL,
          currency: entry.currency,
          tipo: entry.tipo,
          area_m2: entry.areaM2,
          quartos: entry.quartos,
          suites: entry.suites,
          banheiros: entry.banheiros,
          vagas: entry.vagas,
          bairro: entry.bairro,
          cidade: entry.cidade,
          uf: entry.uf,
          andar: entry.andar,
          mobiliado: this.toSqliteBoolean(entry.mobiliado),
          aceita_pet: this.toSqliteBoolean(entry.aceitaPet),
          previous_monthly_total: entry.previousMonthlyTotal,
          monthly_change: entry.monthlyChange,
          change_percent: entry.changePercent,
          observation_count: entry.observationCount,
          rating: entry.rating,
          fair_monthly_total: entry.fairMonthlyTotal,
          delta_percent: entry.deltaPercent,
          price_per_m2: entry.pricePerM2,
          benchmark_scope: entry.benchmarkScope,
          benchmark_label: entry.benchmarkLabel,
          benchmark_sample_size: entry.benchmarkSampleSize,
          warnings: entry.warnings,
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
      .prepare(`UPDATE rental_listings SET embedding = ? WHERE listing_id = ?`)
      .run(buffer, listingId);
  }

  async findSimilar(
    embedding: number[],
    options: SemanticSearchOptions,
  ): Promise<RentalSimilarMatch[]> {
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
           (SELECT monthly_total FROM rental_snapshots
             WHERE listing_id = l.listing_id ORDER BY timestamp DESC LIMIT 1) as last_monthly_total,
           (SELECT rating FROM rental_snapshots
             WHERE listing_id = l.listing_id ORDER BY timestamp DESC LIMIT 1) as rating
         FROM rental_listings l
         WHERE l.embedding IS NOT NULL`,
      )
      .all() as SimilarRow[];

    const excludeSet = new Set(options.excludeListingIds ?? []);
    const scored: RentalSimilarMatch[] = [];

    for (const row of rows) {
      if (excludeSet.has(row.listing_id)) continue;
      if (row.last_monthly_total === null || row.last_monthly_total === undefined) {
        continue;
      }

      const vector = this.codec.decode(row.embedding);
      const similarity = this.codec.cosineSimilarity(embedding, vector);
      if (options.minSimilarity && similarity < options.minSimilarity) continue;

      scored.push({
        listingId: row.listing_id,
        title: row.title,
        url: row.url,
        query: row.query,
        similarity,
        lastMonthlyTotal: row.last_monthly_total,
        lastSeenAt: row.last_seen_at,
        rating: row.rating,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, options.limit);
  }

  private toSqliteBoolean(value: boolean | null): number | null {
    if (value === null) return null;
    return value ? 1 : 0;
  }

  private applySchema(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS rental_listings (
        listing_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        location TEXT,
        query TEXT NOT NULL,
        embedding BLOB,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rental_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id TEXT NOT NULL,
        query TEXT NOT NULL,
        source TEXT NOT NULL,
        rent_brl REAL NOT NULL,
        condominio_brl REAL,
        iptu_mensal_brl REAL,
        monthly_total REAL NOT NULL,
        currency TEXT NOT NULL,
        tipo TEXT,
        area_m2 REAL,
        quartos INTEGER,
        suites INTEGER,
        banheiros INTEGER,
        vagas INTEGER,
        bairro TEXT,
        cidade TEXT,
        uf TEXT,
        andar INTEGER,
        mobiliado INTEGER,
        aceita_pet INTEGER,
        previous_monthly_total REAL,
        monthly_change REAL,
        change_percent REAL,
        observation_count INTEGER NOT NULL,
        rating TEXT,
        fair_monthly_total REAL,
        delta_percent REAL,
        price_per_m2 REAL,
        benchmark_scope TEXT,
        benchmark_label TEXT,
        benchmark_sample_size INTEGER,
        warnings TEXT,
        rating_reasoning TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (listing_id) REFERENCES rental_listings(listing_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rental_snapshots_listing ON rental_snapshots(listing_id);
      CREATE INDEX IF NOT EXISTS idx_rental_snapshots_time ON rental_snapshots(timestamp);
      CREATE INDEX IF NOT EXISTS idx_rental_snapshots_query ON rental_snapshots(query);
      CREATE INDEX IF NOT EXISTS idx_rental_snapshots_geo ON rental_snapshots(cidade, bairro, quartos);
    `);
  }

  private assertReady(): void {
    if (!this.db) {
      throw new Error(
        "SqliteRentalHistoryStore not initialized. Call ensureInitialized() first.",
      );
    }
  }
}
