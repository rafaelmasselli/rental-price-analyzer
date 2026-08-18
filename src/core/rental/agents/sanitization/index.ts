import type { IRentalAgent } from "../../../ports/index.js";
import type {
  RentalGraphState,
  RentalListing,
} from "../../../../shared/models/index.js";

export interface RentalSanitizationOptions {
  minMonthlyTotal: number;
  /** Rent above this is almost certainly a sale ad that leaked into the results. */
  maxMonthlyTotal: number;
  excludedKeywords: string[];
}

interface FilterStats {
  invalidPrice: number;
  excludedKeyword: number;
  duplicateId: number;
}

export class RentalSanitizationAgent implements IRentalAgent {
  constructor(private readonly options: RentalSanitizationOptions) {}

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    console.log(
      `\n[RentalSanitizationAgent] Filtering ${state.rawListings.length} raw listings...`,
    );

    const stats: FilterStats = {
      invalidPrice: 0,
      excludedKeyword: 0,
      duplicateId: 0,
    };

    const withValidPrice = state.rawListings.filter((listing) => {
      const valid =
        Number.isFinite(listing.rentBRL) &&
        listing.rentBRL >= this.options.minMonthlyTotal &&
        listing.rentBRL <= this.options.maxMonthlyTotal;
      if (!valid) stats.invalidPrice += 1;
      return valid;
    });

    const withoutExcluded = this.filterKeywords(withValidPrice, stats);
    const unique = this.deduplicateById(withoutExcluded, stats);

    console.log(
      `[RentalSanitizationAgent] Kept ${unique.length} | dropped: ` +
        `${stats.invalidPrice} out of price range, ${stats.excludedKeyword} excluded keyword, ` +
        `${stats.duplicateId} duplicate ids`,
    );

    return { rawListings: unique };
  }

  private filterKeywords(
    listings: RentalListing[],
    stats: FilterStats,
  ): RentalListing[] {
    const needles = this.options.excludedKeywords.map((k) =>
      this.normalize(k),
    );
    if (needles.length === 0) return listings;

    return listings.filter((listing) => {
      const haystack = this.normalize(
        `${listing.category ?? ""} ${listing.title}`,
      );
      const matches = needles.some((needle) => haystack.includes(needle));
      if (matches) stats.excludedKeyword += 1;
      return !matches;
    });
  }

  private deduplicateById(
    listings: RentalListing[],
    stats: FilterStats,
  ): RentalListing[] {
    const seen = new Set<string>();
    const result: RentalListing[] = [];
    for (const listing of listings) {
      if (seen.has(listing.listingId)) {
        stats.duplicateId += 1;
        continue;
      }
      seen.add(listing.listingId);
      result.push(listing);
    }
    return result;
  }

  private normalize(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }
}
