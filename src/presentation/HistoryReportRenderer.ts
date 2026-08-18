import type {
  HistoryQueryFilters,
  HistoryResult,
} from "../infra/storage/index.js";

const RATING_ICON: Record<string, string> = {
  good_deal: "✓",
  fair: "·",
  overpriced: "✗",
};

export class HistoryReportRenderer {
  render(filters: HistoryQueryFilters, results: HistoryResult[]): void {
    const filterParts: string[] = [];
    if (filters.rating) filterParts.push(`rating=${filters.rating}`);
    if (filters.query) filterParts.push(`query="${filters.query}"`);
    if (filters.days) filterParts.push(`days=${filters.days}`);
    if (filters.similarTo) filterParts.push(`similar="${filters.similarTo}"`);
    if (filters.minPrice !== undefined) filterParts.push(`minPrice=${filters.minPrice}`);
    if (filters.maxPrice !== undefined) filterParts.push(`maxPrice=${filters.maxPrice}`);
    filterParts.push(`limit=${filters.limit}`);

    console.log(`\n=== History query (${results.length} result(s)) ===`);
    console.log(`Filters: ${filterParts.join(", ")}`);

    if (results.length === 0) {
      console.log(`\nNo matches found.`);
      return;
    }

    for (const result of results) {
      this.renderEntry(result);
    }
  }

  private renderEntry(result: HistoryResult): void {
    const icon = result.rating ? (RATING_ICON[result.rating] ?? "·") : "·";
    const delta =
      result.deltaPercent !== null
        ? ` (delta ${this.formatSignedPercent(result.deltaPercent)})`
        : "";
    const sim =
      result.similarity !== undefined
        ? ` [${(result.similarity * 100).toFixed(1)}% match]`
        : "";

    console.log(
      `\n${icon} ${this.formatCurrency(result.price)}${delta}${sim} · ${result.title}`,
    );
    console.log(
      `  Query: "${result.query}"  |  Location: ${result.location ?? "N/A"}  |  Seen: ${this.formatRelative(result.timestamp)}`,
    );
    if (result.componentsBreakdown) {
      console.log(`  Parts: ${result.componentsBreakdown}`);
    }
    if (result.ratingReasoning) {
      console.log(`  Why: ${result.ratingReasoning}`);
    }
    console.log(`  URL: ${result.url}`);
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
    const now = Date.now();
    const seconds = Math.max(0, Math.floor((now - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
