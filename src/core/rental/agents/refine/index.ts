import type { IRentalAgent } from "../../../ports/index.js";
import {
  pricePerM2,
  type RentalGraphState,
  type RentalListing,
} from "../../../../shared/models/index.js";

export interface RentalRefineOptions {
  /** Drop listings whose R$/m2 is this many times above/below the local median. */
  outlierMultiplier: number;
  /** Minimum group size before an outlier verdict is trustworthy. */
  minGroupSize?: number;
  /** Area tolerance when deciding two ads are the same unit. */
  areaTolerancePercent?: number;
  /** Monthly-total tolerance when deciding two ads are the same unit. */
  priceTolerancePercent?: number;
}

export class RentalRefineAgent implements IRentalAgent {
  private static readonly DEFAULT_MIN_GROUP_SIZE = 5;
  private static readonly DEFAULT_AREA_TOLERANCE = 3;
  private static readonly DEFAULT_PRICE_TOLERANCE = 2;

  constructor(private readonly options: RentalRefineOptions) {}

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    console.log(
      `\n[RentalRefineAgent] Refining ${state.rawListings.length} listings...`,
    );

    const deduped = this.dedupeSameUnit(state.rawListings);
    const clean = this.dropNeighbourhoodOutliers(deduped);

    console.log(
      `[RentalRefineAgent] Kept ${clean.length} | dropped: ` +
        `${state.rawListings.length - deduped.length} republished duplicates, ` +
        `${deduped.length - clean.length} R$/m² outliers`,
    );

    return { rawListings: clean };
  }

  private dedupeSameUnit(listings: RentalListing[]): RentalListing[] {
    const areaTolerance =
      (this.options.areaTolerancePercent ??
        RentalRefineAgent.DEFAULT_AREA_TOLERANCE) / 100;
    const priceTolerance =
      (this.options.priceTolerancePercent ??
        RentalRefineAgent.DEFAULT_PRICE_TOLERANCE) / 100;

    const kept: RentalListing[] = [];

    for (const candidate of listings) {
      const twinIndex = kept.findIndex((existing) =>
        this.isSameUnit(existing, candidate, areaTolerance, priceTolerance),
      );

      if (twinIndex === -1) {
        kept.push(candidate);
        continue;
      }

      if (this.richness(candidate) > this.richness(kept[twinIndex])) {
        kept[twinIndex] = candidate;
      }
    }

    return kept;
  }

  private isSameUnit(
    a: RentalListing,
    b: RentalListing,
    areaTolerance: number,
    priceTolerance: number,
  ): boolean {
    if (this.normalize(a.attributes.bairro) !== this.normalize(b.attributes.bairro)) {
      return false;
    }
    if (a.attributes.quartos !== b.attributes.quartos) return false;

    if (!this.within(a.monthlyTotalBRL, b.monthlyTotalBRL, priceTolerance)) {
      return false;
    }

    const areaA = a.attributes.areaM2;
    const areaB = b.attributes.areaM2;
    // Without areas, matching neighbourhood + bedrooms + price is already a
    // strong signal, but only when we actually know the neighbourhood.
    if (areaA === null || areaB === null) {
      return a.attributes.bairro !== null;
    }

    return this.within(areaA, areaB, areaTolerance);
  }

  private dropNeighbourhoodOutliers(
    listings: RentalListing[],
  ): RentalListing[] {
    const minGroupSize =
      this.options.minGroupSize ?? RentalRefineAgent.DEFAULT_MIN_GROUP_SIZE;

    const groups = new Map<string, RentalListing[]>();
    for (const listing of listings) {
      const key = this.normalize(listing.attributes.bairro) ?? "__sem_bairro__";
      const bucket = groups.get(key) ?? [];
      bucket.push(listing);
      groups.set(key, bucket);
    }

    const kept = new Set<string>();

    for (const [key, bucket] of groups) {
      const rates = bucket
        .map((listing) => ({ listing, rate: pricePerM2(listing) }))
        .filter(
          (entry): entry is { listing: RentalListing; rate: number } =>
            entry.rate !== null,
        );

      if (key === "__sem_bairro__" || rates.length < minGroupSize) {
        for (const listing of bucket) kept.add(listing.listingId);
        continue;
      }

      const median = this.median(rates.map((entry) => entry.rate));
      const min = median / this.options.outlierMultiplier;
      const max = median * this.options.outlierMultiplier;

      for (const listing of bucket) {
        const rate = pricePerM2(listing);
        if (rate === null || (rate >= min && rate <= max)) {
          kept.add(listing.listingId);
        }
      }
    }

    return listings.filter((listing) => kept.has(listing.listingId));
  }

  /** How many attributes the ad actually fills in. */
  private richness(listing: RentalListing): number {
    return Object.values(listing.attributes).filter(
      (value) => value !== null && value !== "outro",
    ).length;
  }

  private within(a: number, b: number, tolerance: number): boolean {
    const reference = Math.max(a, b);
    if (reference === 0) return true;
    return Math.abs(a - b) / reference <= tolerance;
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private normalize(value: string | null): string | null {
    if (value === null) return null;
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
}
