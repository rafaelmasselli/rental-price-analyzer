import type { IAgent } from "../../ports/index.js";
import type { GraphState, Listing } from "../../../shared/models/index.js";

export interface SanitizationOptions {
  excludedCategories: string[];
  outlierMultiplier: number;
  minPrice: number;
}

interface FilterStats {
  invalidPrice: number;
  excludedCategory: number;
  duplicate: number;
  outlier: number;
}

export class SanitizationAgent implements IAgent {
  constructor(private readonly options: SanitizationOptions) {}

  async run(state: GraphState): Promise<Partial<GraphState>> {
    console.log(
      `\n[SanitizationAgent] Filtering ${state.rawListings.length} raw listings...`,
    );

    const stats: FilterStats = {
      invalidPrice: 0,
      excludedCategory: 0,
      duplicate: 0,
      outlier: 0,
    };

    const withValidPrice = this.filterValidPrice(state.rawListings, stats);
    const withoutExcluded = this.filterExcludedCategories(withValidPrice, stats);
    const unique = this.deduplicate(withoutExcluded, stats);
    const clean = this.dropOutliers(unique, stats);

    console.log(
      `[SanitizationAgent] Kept ${clean.length} | dropped: ` +
        `${stats.invalidPrice} invalid price, ${stats.excludedCategory} excluded, ` +
        `${stats.duplicate} duplicates, ${stats.outlier} outliers`,
    );

    return { rawListings: clean };
  }

  private filterValidPrice(listings: Listing[], stats: FilterStats): Listing[] {
    return listings.filter((listing) => {
      const valid =
        Number.isFinite(listing.price) && listing.price >= this.options.minPrice;
      if (!valid) stats.invalidPrice += 1;
      return valid;
    });
  }

  private filterExcludedCategories(
    listings: Listing[],
    stats: FilterStats,
  ): Listing[] {
    const excluded = this.options.excludedCategories.map((c) => c.toLowerCase());
    if (excluded.length === 0) return listings;

    return listings.filter((listing) => {
      const haystack = `${listing.category ?? ""} ${listing.title}`.toLowerCase();
      const matches = excluded.some((needle) => haystack.includes(needle));
      if (matches) stats.excludedCategory += 1;
      return !matches;
    });
  }

  private deduplicate(listings: Listing[], stats: FilterStats): Listing[] {
    const seen = new Set<string>();
    const result: Listing[] = [];
    for (const listing of listings) {
      if (seen.has(listing.listingId)) {
        stats.duplicate += 1;
        continue;
      }
      seen.add(listing.listingId);
      result.push(listing);
    }
    return result;
  }

  private dropOutliers(listings: Listing[], stats: FilterStats): Listing[] {
    if (listings.length < 3) return listings;

    const median = this.median(listings.map((l) => l.price));
    const minAllowed = median / this.options.outlierMultiplier;
    const maxAllowed = median * this.options.outlierMultiplier;

    return listings.filter((listing) => {
      const ok = listing.price >= minAllowed && listing.price <= maxAllowed;
      if (!ok) stats.outlier += 1;
      return ok;
    });
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}
