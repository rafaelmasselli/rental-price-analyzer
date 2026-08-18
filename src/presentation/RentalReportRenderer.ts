import type {
  RentalAnalysis,
  RentalGraphState,
  RentalListingWithDelta,
  RentalSimilarMatch,
  RentalTopPick,
} from "../shared/models/index.js";

type Bucket = "good_deal" | "fair" | "overpriced" | "suspicious";

const BUCKET_ICON: Record<Bucket, string> = {
  good_deal: "✓",
  fair: "·",
  overpriced: "✗",
  suspicious: "⚠",
};

const BUCKET_LABEL: Record<Bucket, string> = {
  good_deal: "Abaixo do mercado",
  fair: "No mercado",
  overpriced: "Acima do mercado",
  suspicious: "Barato demais para ser verdade — confira antes",
};

const BUCKET_ORDER: Bucket[] = ["good_deal", "fair", "overpriced", "suspicious"];

export class RentalReportRenderer {
  render(state: RentalGraphState): void {
    console.log(`\n=== Investigação de aluguel (OLX Imóveis) ===`);
    console.log(`Busca: ${state.query}`);
    if (state.expandedQueries.length > 1) {
      console.log(`Variações: ${state.expandedQueries.join(" | ")}`);
    }
    console.log(`Imóveis analisados: ${state.listingsWithHistory.length}`);
    console.log(`Histórico: ${state.dbPath}`);

    if (!state.analysis) {
      console.log("Nenhuma análise produzida.");
      return;
    }

    this.renderTopPicks(state.analysis.topPicks);
    this.renderRatingBreakdown(state.listingsWithHistory);
    this.renderCheapest(state.analysis.cheapestListing);
    this.renderMarketStats(state.analysis);
    this.renderDrops(state.analysis.significantDrops);
    this.renderSimilarHistory(state.similarListings);
    console.log(`\nRecomendação:\n${state.analysis.recommendation}`);
  }

  private renderTopPicks(topPicks: RentalTopPick[]): void {
    if (topPicks.length === 0) {
      console.log(`\nMelhores opções: nenhuma ranqueada.`);
      return;
    }

    console.log(`\nMelhores opções:`);
    topPicks.forEach((pick, index) => {
      const listing = pick.listing;
      console.log(
        `  ${index + 1}. (nota ${pick.score.toFixed(1)}) ${listing.title}`,
      );
      console.log(`     ${this.costLine(listing)}`);
      console.log(`     ${this.attributeLine(listing)}`);
      console.log(`     Por quê: ${pick.reasoning}`);
      console.log(`     URL: ${listing.url}`);
    });
  }

  private renderRatingBreakdown(listings: RentalListingWithDelta[]): void {
    const grouped = this.groupByRating(listings);
    if (grouped.size === 0) return;

    console.log(`\n=== Comparação com o benchmark do bairro ===`);
    for (const name of BUCKET_ORDER) {
      const bucket = grouped.get(name);
      if (!bucket || bucket.length === 0) continue;

      console.log(
        `\n${BUCKET_ICON[name]} ${BUCKET_LABEL[name]} (${bucket.length}):`,
      );
      for (const listing of bucket) {
        this.renderListingWithRating(listing);
      }
    }
  }

  private renderListingWithRating(listing: RentalListingWithDelta): void {
    const rating = listing.rating;
    const delta = rating
      ? ` (${this.formatSignedPercent(rating.deltaPercent)})`
      : "";

    console.log(
      `  - ${this.formatCurrency(listing.monthlyTotalBRL)}/mês${delta} · ${listing.title}`,
    );
    console.log(`    ${this.attributeLine(listing)}`);

    if (!rating) return;

    console.log(`    ${rating.reasoning}`);
    if (rating.warnings.length > 0) {
      console.log(`    ⚠ ${rating.warnings.join(" | ")}`);
    }
  }

  private costLine(listing: RentalListingWithDelta): string {
    const parts = [`Aluguel ${this.formatCurrency(listing.rentBRL)}`];
    const { condominioBRL, iptuMensalBRL } = listing.attributes;
    parts.push(
      condominioBRL !== null
        ? `cond. ${this.formatCurrency(condominioBRL)}`
        : "cond. não informado",
    );
    if (iptuMensalBRL !== null) {
      parts.push(`IPTU ${this.formatCurrency(iptuMensalBRL)}`);
    }
    return `${parts.join(" + ")} = ${this.formatCurrency(listing.monthlyTotalBRL)}/mês`;
  }

  private attributeLine(listing: RentalListingWithDelta): string {
    const { attributes } = listing;
    const parts: string[] = [attributes.tipo];
    if (attributes.quartos !== null) parts.push(`${attributes.quartos} quartos`);
    if (attributes.areaM2 !== null) parts.push(`${attributes.areaM2} m²`);
    if (attributes.vagas !== null) parts.push(`${attributes.vagas} vaga(s)`);
    if (attributes.mobiliado) parts.push("mobiliado");
    const pricePerM2 = listing.rating?.pricePerM2;
    if (pricePerM2 != null) {
      parts.push(`${this.formatCurrency(pricePerM2)}/m²`);
    }
    parts.push(attributes.bairro ?? listing.location);
    return parts.join(" · ");
  }

  private groupByRating(
    listings: RentalListingWithDelta[],
  ): Map<Bucket, RentalListingWithDelta[]> {
    const map = new Map<Bucket, RentalListingWithDelta[]>();
    for (const listing of listings) {
      const key: Bucket = listing.rating?.suspicious
        ? "suspicious"
        : listing.rating?.classification ?? "fair";
      const bucket = map.get(key) ?? [];
      bucket.push(listing);
      map.set(key, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort(
        (a, b) => (a.rating?.deltaPercent ?? 0) - (b.rating?.deltaPercent ?? 0),
      );
    }
    return map;
  }

  private renderCheapest(cheapest: RentalListingWithDelta | null): void {
    console.log(`\nMenor custo mensal: ${cheapest?.title ?? "N/A"}`);
    if (!cheapest) return;
    console.log(`  ${this.costLine(cheapest)}`);
    console.log(`  ${this.attributeLine(cheapest)}`);
    console.log(`  URL: ${cheapest.url}`);
  }

  private renderMarketStats(analysis: RentalAnalysis): void {
    console.log(
      `\nCusto mensal médio: ${this.formatCurrency(analysis.averageMonthlyTotal)}`,
    );
    console.log(
      `Faixa: ${this.formatCurrency(analysis.monthlyTotalRange.min)} - ${this.formatCurrency(analysis.monthlyTotalRange.max)}`,
    );
    if (analysis.medianPricePerM2 !== null) {
      console.log(
        `Mediana da amostra: ${this.formatCurrency(analysis.medianPricePerM2)}/m²/mês`,
      );
    }
    console.log(
      `Variação de mercado: ${analysis.marketVariationPercent.toFixed(2)}%`,
    );
  }

  private renderDrops(drops: RentalListingWithDelta[]): void {
    if (drops.length === 0) {
      console.log(`\nNenhuma queda de preço nesta rodada.`);
      return;
    }
    console.log(`\nQuedas de preço detectadas (margem de negociação):`);
    for (const drop of drops) {
      console.log(`  - ${drop.title} :: ${this.formatDelta(drop)}`);
      console.log(`    ${drop.url}`);
    }
  }

  private renderSimilarHistory(matches: RentalSimilarMatch[]): void {
    if (matches.length === 0) return;
    console.log(`\n=== Imóveis parecidos vistos antes (busca semântica) ===`);
    for (const match of matches) {
      const similarity = (match.similarity * 100).toFixed(1);
      const rating = match.rating ? ` [${match.rating}]` : "";
      console.log(
        `  ${similarity}% · ${this.formatCurrency(match.lastMonthlyTotal)}/mês${rating} · ${match.title}`,
      );
      console.log(`    visto em "${match.query}" em ${match.lastSeenAt}`);
      console.log(`    ${match.url}`);
    }
  }

  private formatDelta(listing: RentalListingWithDelta): string {
    if (listing.monthlyChange === null || listing.previousMonthlyTotal === null) {
      return "primeira observação";
    }
    const arrow =
      listing.monthlyChange < 0 ? "▼" : listing.monthlyChange > 0 ? "▲" : "•";
    const pct = listing.changePercent?.toFixed(2) ?? "0.00";
    return `${arrow} ${this.formatCurrency(listing.previousMonthlyTotal)} → ${this.formatCurrency(listing.monthlyTotalBRL)} (${pct}%)`;
  }

  private formatSignedPercent(value: number): string {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}% vs bairro`;
  }

  private formatCurrency(value: number, currency = "BRL"): string {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  }
}
