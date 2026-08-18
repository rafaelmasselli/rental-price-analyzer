import type {
  AnalyzedTopPick,
  HistoricalAnalysisResult,
  HistoricalStats,
} from "../core/services/index.js";
import type { HistoryQueryFilters } from "../infra/storage/index.js";

const RATING_ICON: Record<string, string> = {
  good_deal: "✓",
  fair: "·",
  overpriced: "✗",
  unrated: "?",
};

export class HistoricalAnalysisRenderer {
  render(result: HistoricalAnalysisResult | null, filters: HistoryQueryFilters): void {
    if (!result) {
      console.log(`\n=== Historical Analysis ===`);
      this.renderFilters(filters);
      console.log(`\nNo matching listings in history. Run "npm run dev" first to populate the database.`);
      return;
    }

    console.log(`\n=== Historical Analysis ===`);
    this.renderFilters(filters);
    this.renderStats(result.stats);
    this.renderTopPicks(result.topPicks);
    this.renderInsights(result);
  }

  private renderFilters(filters: HistoryQueryFilters): void {
    const parts: string[] = [];
    if (filters.rating) parts.push(`rating=${filters.rating}`);
    if (filters.query) parts.push(`query="${filters.query}"`);
    if (filters.days) parts.push(`days=${filters.days}`);
    if (filters.similarTo) parts.push(`similar="${filters.similarTo}"`);
    if (filters.minPrice !== undefined) parts.push(`minPrice=${filters.minPrice}`);
    if (filters.maxPrice !== undefined) parts.push(`maxPrice=${filters.maxPrice}`);
    parts.push(`limit=${filters.limit}`);
    console.log(`Filters: ${parts.join(", ")}`);
  }

  private renderStats(stats: HistoricalStats): void {
    console.log(`\nListings analyzed: ${stats.totalListings}`);
    console.log(
      `Price range:  ${this.formatCurrency(stats.priceMin)} – ${this.formatCurrency(stats.priceMax)}`,
    );
    console.log(`Median:       ${this.formatCurrency(stats.priceMedian)}`);
    console.log(`Mean:         ${this.formatCurrency(stats.priceMean)}`);
    console.log(`Avg delta:    ${stats.averageDeltaPercent.toFixed(2)}%`);

    console.log(`\nBy rating:`);
    for (const [key, count] of Object.entries(stats.byRating)) {
      if (count === 0) continue;
      const pct = ((count / stats.totalListings) * 100).toFixed(0);
      console.log(`  ${RATING_ICON[key] ?? "·"} ${key.padEnd(11)} ${String(count).padStart(3)}  (${pct}%)`);
    }
  }

  private renderTopPicks(picks: AnalyzedTopPick[]): void {
    if (picks.length === 0) {
      console.log(`\nTop picks: none identified.`);
      return;
    }

    console.log(`\nTop historical picks:`);
    picks.forEach((pick, index) => {
      const listing = pick.listing;
      const delta =
        listing.deltaPercent !== null
          ? ` (delta ${this.formatSignedPercent(listing.deltaPercent)})`
          : "";
      const ratingIcon = listing.rating ? RATING_ICON[listing.rating] ?? "·" : "·";

      console.log(
        `\n  ${index + 1}. ${ratingIcon} (score ${pick.score.toFixed(1)}) ${listing.title}`,
      );
      console.log(
        `     ${this.formatCurrency(listing.price)}${delta} · ${listing.location ?? "N/A"} · seen ${this.formatRelative(listing.timestamp)}`,
      );
      if (listing.componentsBreakdown) {
        console.log(`     Parts: ${listing.componentsBreakdown}`);
      }
      console.log(`     Why: ${pick.reasoning}`);
      console.log(`     URL: ${listing.url}`);
    });
  }

  private renderInsights(result: HistoricalAnalysisResult): void {
    console.log(`\n--- Market patterns ---`);
    console.log(result.marketPatterns);

    console.log(`\n--- Component observations ---`);
    console.log(result.componentObservations);

    console.log(`\n--- Comprar ou esperar? ---`);
    console.log(result.buyOrWait);
  }

  private formatSignedPercent(value: number): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }

  private formatRelative(timestamp: string): string {
    const then = new Date(timestamp).getTime();
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
