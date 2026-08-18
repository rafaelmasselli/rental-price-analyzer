import type {
  GraphState,
  ListingWithDelta,
  SimilarMatchState,
  TopPick,
} from "../shared/models/index.js";

type RatingClass = "good_deal" | "fair" | "overpriced";

const RATING_ICON: Record<RatingClass, string> = {
  good_deal: "✓",
  fair: "·",
  overpriced: "✗",
};

const RATING_LABEL: Record<RatingClass, string> = {
  good_deal: "Good deals",
  fair: "Fair",
  overpriced: "Overpriced",
};

export class ReportRenderer {
  render(state: GraphState): void {
    console.log(`\n=== OLX Price Investigation ===`);
    console.log(`Query: ${state.query}`);
    if (state.expandedQueries.length > 1) {
      console.log(`Variations: ${state.expandedQueries.join(" | ")}`);
    }
    console.log(`Listings analyzed: ${state.listingsWithHistory.length}`);
    console.log(`History CSV: ${state.csvPath}`);

    if (!state.analysis) {
      console.log("No analysis produced.");
      return;
    }

    this.renderTopPicks(state.analysis.topPicks);
    this.renderRatingBreakdown(state.listingsWithHistory);
    this.renderCheapest(state.analysis.cheapestListing);
    this.renderMarketStats(state.analysis);
    this.renderDrops(state.analysis.significantDrops);
    this.renderSimilarHistory(state.similarListings);
    console.log(`\nRecommendation:\n${state.analysis.recommendation}`);
  }

  private renderSimilarHistory(matches: SimilarMatchState[]): void {
    if (matches.length === 0) return;
    console.log(`\n=== Similar listings from history (semantic search) ===`);
    for (const match of matches) {
      const sim = (match.similarity * 100).toFixed(1);
      const rating = match.rating ? ` [${match.rating}]` : "";
      console.log(
        `  ${sim}% match · ${this.formatCurrency(match.lastPrice)}${rating} · ${match.title}`,
      );
      console.log(
        `    seen on "${match.query}" at ${match.lastSeenAt}`,
      );
      console.log(`    ${match.url}`);
    }
  }

  private renderTopPicks(topPicks: TopPick[]): void {
    if (topPicks.length === 0) {
      console.log(`\nTop picks: none ranked.`);
      return;
    }

    console.log(`\nTop picks:`);
    topPicks.forEach((pick, index) => {
      console.log(
        `  ${index + 1}. (score ${pick.score.toFixed(1)}) ${pick.listing.title}`,
      );
      console.log(
        `     Price: ${this.formatCurrency(pick.listing.price, pick.listing.currency)} · ${pick.listing.location}`,
      );
      console.log(`     Why: ${pick.reasoning}`);
      console.log(`     URL: ${pick.listing.url}`);
    });
  }

  private renderRatingBreakdown(listings: ListingWithDelta[]): void {
    const grouped = this.groupByRating(listings);
    if (grouped.size === 0) return;

    console.log(`\n=== Market rating breakdown ===`);
    for (const ratingClass of ["good_deal", "fair", "overpriced"] as RatingClass[]) {
      const bucket = grouped.get(ratingClass);
      if (!bucket || bucket.length === 0) continue;
      console.log(
        `\n${RATING_ICON[ratingClass]} ${RATING_LABEL[ratingClass]} (${bucket.length}):`,
      );
      for (const listing of bucket) {
        this.renderListingWithRating(listing);
      }
    }
  }

  private renderListingWithRating(listing: ListingWithDelta): void {
    const rating = listing.rating;
    const price = this.formatCurrency(listing.price, listing.currency);
    const deltaLabel = rating
      ? ` (delta ${this.formatSignedPercent(rating.deltaPercent)})`
      : "";

    console.log(`  - ${price}${deltaLabel} · ${listing.title}`);

    if (!rating) return;

    if (rating.components.length > 0) {
      const breakdown = rating.components
        .map(
          (c) => `${c.category}:${c.spec}≈${this.formatCurrency(c.estimatedPriceBRL)}`,
        )
        .join(" + ");
      const fair = this.formatCurrency(rating.estimatedFairTotalBRL);
      console.log(`    Parts: ${breakdown} = ${fair} fair`);
    }
    if (rating.missingStandardComponents.length > 0) {
      console.log(`    Missing: ${rating.missingStandardComponents.join(", ")}`);
    }
    console.log(`    Why: ${rating.reasoning}`);
  }

  private groupByRating(
    listings: ListingWithDelta[],
  ): Map<RatingClass, ListingWithDelta[]> {
    const map = new Map<RatingClass, ListingWithDelta[]>();
    for (const listing of listings) {
      const key = (listing.rating?.classification ?? "fair") as RatingClass;
      const bucket = map.get(key) ?? [];
      bucket.push(listing);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => this.deltaOf(a) - this.deltaOf(b));
    }
    return map;
  }

  private deltaOf(listing: ListingWithDelta): number {
    return listing.rating?.deltaPercent ?? 0;
  }

  private renderCheapest(cheapest: ListingWithDelta | null): void {
    console.log(`\nAbsolute cheapest: ${cheapest?.title ?? "N/A"}`);
    console.log(
      `  Price:    ${cheapest ? this.formatCurrency(cheapest.price, cheapest.currency) : "N/A"}`,
    );
    console.log(`  Location: ${cheapest?.location ?? "N/A"}`);
    console.log(`  URL:      ${cheapest?.url ?? "N/A"}`);
  }

  private renderMarketStats(
    analysis: NonNullable<GraphState["analysis"]>,
  ): void {
    console.log(`\nAverage: ${this.formatCurrency(analysis.averagePrice)}`);
    console.log(
      `Range:   ${this.formatCurrency(analysis.priceRange.min)} - ${this.formatCurrency(analysis.priceRange.max)}`,
    );
    console.log(
      `Market variation: ${analysis.marketVariationPercent.toFixed(2)}%`,
    );
  }

  private renderDrops(drops: ListingWithDelta[]): void {
    if (drops.length === 0) {
      console.log(`\nNo significant drops in this run.`);
      return;
    }
    console.log(`\nPrice drops detected:`);
    for (const drop of drops) {
      console.log(`  - ${drop.title} :: ${this.formatDelta(drop)}`);
      console.log(`    ${drop.url}`);
    }
  }

  private formatDelta(listing: ListingWithDelta): string {
    if (listing.priceChange === null || listing.previousPrice === null) {
      return "first observation";
    }
    const arrow =
      listing.priceChange < 0 ? "▼" : listing.priceChange > 0 ? "▲" : "•";
    const pct = listing.changePercent?.toFixed(2) ?? "0.00";
    return `${arrow} ${this.formatCurrency(listing.previousPrice)} → ${this.formatCurrency(listing.price)} (${pct}%)`;
  }

  private formatSignedPercent(value: number): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  }

  private formatCurrency(value: number, currency = "BRL"): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value);
  }
}
