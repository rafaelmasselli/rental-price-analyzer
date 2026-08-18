import type {
  BenchmarkKey,
  CompRecord,
  ILLMProvider,
  IRentBenchmarkLookup,
  IRentalAgent,
  IRentalHistoryStore,
} from "../../../ports/index.js";
import {
  pricePerM2,
  type RentBenchmark,
  type RentalGraphState,
  type RentalListing,
  type RentalRating,
} from "../../../../shared/models/index.js";
import { rentEstimatePrompt } from "./prompt.js";
import { rentEstimateSchema, type RentEstimateOutput } from "./schema.js";

export interface RentalBenchmarkOptions {
  /** How far back comparables are still considered representative. */
  compWindowDays: number;
  /** |delta| beyond this classifies the listing. */
  classificationThresholdPercent?: number;
  /** A delta below this is treated as too good to be true, not as a deal. */
  suspiciousDiscountPercent?: number;
  batchSize?: number;
}

interface RunSummary {
  good: number;
  fair: number;
  overpriced: number;
  fromComps: number;
  fromLlm: number;
  unrated: number;
}

/**
 * The rental counterpart of the PC-parts rating agent. Where that one summed
 * component prices fetched from Mercado Livre, this one derives a fair monthly
 * cost from comparables — median R$/m2 of similar units nearby — and falls back
 * to an LLM appraisal only when the sample is too thin to trust.
 */
export class RentalBenchmarkAgent implements IRentalAgent {
  private static readonly DEFAULT_THRESHOLD = 12;
  private static readonly DEFAULT_SUSPICIOUS_DISCOUNT = -40;
  private static readonly DEFAULT_BATCH_SIZE = 25;
  /** Condo fee above this share of the rent distorts the real cost. */
  private static readonly HIGH_CONDO_SHARE = 0.4;

  constructor(
    private readonly benchmark: IRentBenchmarkLookup,
    private readonly store: IRentalHistoryStore,
    private readonly llmProvider: ILLMProvider,
    private readonly options: RentalBenchmarkOptions,
  ) {}

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    if (state.rawListings.length === 0) return { rawListings: [] };

    await this.primeComparables(state.rawListings);

    console.log(
      `[RentalBenchmarkAgent] Pricing ${state.rawListings.length} listings against neighbourhood comparables...`,
    );

    const benchmarks = new Map<string, RentBenchmark | null>();
    const needEstimate: RentalListing[] = [];

    for (const listing of state.rawListings) {
      const found = await this.benchmark.lookup(this.toKey(listing));
      benchmarks.set(listing.listingId, found);
      if (!this.isUsable(found, listing)) needEstimate.push(listing);
    }

    const estimates = await this.estimateMissing(state, needEstimate);

    const summary: RunSummary = {
      good: 0,
      fair: 0,
      overpriced: 0,
      fromComps: 0,
      fromLlm: 0,
      unrated: 0,
    };

    const rated = state.rawListings.map((listing) => {
      const rating = this.buildRating(
        listing,
        benchmarks.get(listing.listingId) ?? null,
        estimates,
        summary,
      );
      if (!rating) {
        summary.unrated += 1;
        return listing;
      }
      this.tally(summary, rating.classification);
      return { ...listing, rating };
    });

    console.log(
      `[RentalBenchmarkAgent] good_deal: ${summary.good} · fair: ${summary.fair} · overpriced: ${summary.overpriced} · unrated: ${summary.unrated}`,
    );
    console.log(
      `[RentalBenchmarkAgent] Fair-price source: comparables=${summary.fromComps} · llm_estimate=${summary.fromLlm}`,
    );

    return { rawListings: rated };
  }

  /**
   * Comparables come from the accumulated history AND from the current batch —
   * without the batch, the very first run would have nothing to compare against.
   */
  private async primeComparables(listings: RentalListing[]): Promise<void> {
    await this.store.ensureInitialized();
    const historical = await this.store.loadComps(this.options.compWindowDays);
    const current: CompRecord[] = listings.map((listing) => ({
      cidade: listing.attributes.cidade,
      bairro: listing.attributes.bairro,
      quartos: listing.attributes.quartos,
      tipo: listing.attributes.tipo,
      areaM2: listing.attributes.areaM2,
      monthlyTotalBRL: listing.monthlyTotalBRL,
    }));

    await this.benchmark.prime(historical);
    await this.benchmark.prime(current);

    console.log(
      `\n[RentalBenchmarkAgent] Comparables pool: ${historical.length} from history (last ${this.options.compWindowDays}d) + ${current.length} from this run.`,
    );
  }

  private isUsable(
    benchmark: RentBenchmark | null,
    listing: RentalListing,
  ): boolean {
    if (!benchmark) return false;
    if (benchmark.medianPricePerM2 !== null && listing.attributes.areaM2) {
      return true;
    }
    return benchmark.medianMonthlyTotal !== null;
  }

  private async estimateMissing(
    state: RentalGraphState,
    listings: RentalListing[],
  ): Promise<Map<string, RentEstimateOutput["estimates"][number]>> {
    const result = new Map<string, RentEstimateOutput["estimates"][number]>();
    if (listings.length === 0) return result;

    console.log(
      `[RentalBenchmarkAgent] ${listings.length} listings have too few comparables — asking the LLM for a fallback appraisal...`,
    );

    const batchSize =
      this.options.batchSize ?? RentalBenchmarkAgent.DEFAULT_BATCH_SIZE;

    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);
      try {
        const chain = rentEstimatePrompt.pipe(
          this.llmProvider.getModel().withStructuredOutput(rentEstimateSchema),
        );
        const response = (await chain.invoke({
          query: state.query,
          listings: JSON.stringify(
            batch.map((listing) => ({
              listingId: listing.listingId,
              title: listing.title,
              monthlyTotalBRL: listing.monthlyTotalBRL,
              attributes: listing.attributes,
            })),
            null,
            2,
          ),
        })) as RentEstimateOutput;

        for (const estimate of response.estimates) {
          result.set(estimate.listingId, estimate);
        }
      } catch (error) {
        console.log(
          `[RentalBenchmarkAgent] Fallback appraisal failed: ${(error as Error).message}`,
        );
      }
    }

    return result;
  }

  private buildRating(
    listing: RentalListing,
    benchmark: RentBenchmark | null,
    estimates: Map<string, RentEstimateOutput["estimates"][number]>,
    summary: RunSummary,
  ): RentalRating | null {
    const rate = pricePerM2(listing);
    const area = listing.attributes.areaM2;

    let fair: number | null;
    let usedBenchmark: RentBenchmark;

    if (benchmark && benchmark.medianPricePerM2 !== null && area) {
      fair = benchmark.medianPricePerM2 * area;
      usedBenchmark = benchmark;
      summary.fromComps += 1;
    } else if (benchmark && benchmark.medianMonthlyTotal !== null) {
      fair = benchmark.medianMonthlyTotal;
      usedBenchmark = benchmark;
      summary.fromComps += 1;
    } else {
      const estimate = estimates.get(listing.listingId);
      if (!estimate || estimate.fairMonthlyTotalBRL <= 0) return null;
      fair = estimate.fairMonthlyTotalBRL;
      usedBenchmark = {
        scope: "llm_estimate",
        label: `estimativa do modelo (confiança ${estimate.confidence})`,
        medianPricePerM2: area ? Number((fair / area).toFixed(2)) : null,
        medianMonthlyTotal: Math.round(fair),
        sampleSize: 0,
      };
      summary.fromLlm += 1;
    }

    const deltaPercent = ((listing.monthlyTotalBRL - fair) / fair) * 100;

    return {
      classification: this.classify(deltaPercent),
      suspicious: deltaPercent <= this.suspiciousThreshold(),
      fairMonthlyTotalBRL: Math.round(fair),
      deltaPercent: Number(deltaPercent.toFixed(2)),
      pricePerM2: rate === null ? null : Number(rate.toFixed(2)),
      benchmark: usedBenchmark,
      warnings: this.collectWarnings(listing, usedBenchmark, deltaPercent),
      reasoning: this.buildReasoning(
        listing,
        usedBenchmark,
        fair,
        deltaPercent,
      ),
    };
  }

  private suspiciousThreshold(): number {
    return (
      this.options.suspiciousDiscountPercent ??
      RentalBenchmarkAgent.DEFAULT_SUSPICIOUS_DISCOUNT
    );
  }

  private classify(deltaPercent: number): RentalRating["classification"] {
    const threshold =
      this.options.classificationThresholdPercent ??
      RentalBenchmarkAgent.DEFAULT_THRESHOLD;
    const suspicious = this.suspiciousThreshold();

    // Far below market is not a bargain, it is a missing piece of information.
    if (deltaPercent <= suspicious) return "fair";
    if (deltaPercent <= -threshold) return "good_deal";
    if (deltaPercent >= threshold) return "overpriced";
    return "fair";
  }

  private collectWarnings(
    listing: RentalListing,
    benchmark: RentBenchmark,
    deltaPercent: number,
  ): string[] {
    const warnings: string[] = [];
    const { attributes } = listing;

    if (attributes.condominioBRL === null) {
      warnings.push("condomínio não informado — custo real pode ser bem maior");
    } else if (
      attributes.condominioBRL >
      listing.rentBRL * RentalBenchmarkAgent.HIGH_CONDO_SHARE
    ) {
      warnings.push(
        `condomínio alto: R$${Math.round(attributes.condominioBRL)} sobre aluguel de R$${Math.round(listing.rentBRL)}`,
      );
    }

    if (attributes.iptuMensalBRL === null) {
      warnings.push("IPTU não informado");
    }
    if (attributes.areaM2 === null) {
      warnings.push("área não informada — comparação por R$/m² indisponível");
    }
    if (attributes.bairro === null) {
      warnings.push("bairro não identificado — benchmark menos preciso");
    }

    if (deltaPercent <= this.suspiciousThreshold()) {
      warnings.push(
        `${deltaPercent.toFixed(0)}% abaixo do mercado — provável anúncio incompleto ou golpe`,
      );
    }

    if (benchmark.scope === "llm_estimate") {
      warnings.push(
        "sem comparáveis suficientes — preço justo estimado pelo modelo",
      );
    } else if (
      benchmark.scope === "cidade" ||
      benchmark.scope === "cidade_quartos"
    ) {
      warnings.push(
        "benchmark apenas em nível de cidade — pouca amostra no bairro",
      );
    }

    return warnings;
  }

  private buildReasoning(
    listing: RentalListing,
    benchmark: RentBenchmark,
    fair: number,
    deltaPercent: number,
  ): string {
    const parts: string[] = [];
    const { attributes } = listing;

    parts.push(
      `aluguel R$${Math.round(listing.rentBRL)}` +
        (attributes.condominioBRL !== null
          ? ` + cond. R$${Math.round(attributes.condominioBRL)}`
          : "") +
        (attributes.iptuMensalBRL !== null
          ? ` + IPTU R$${Math.round(attributes.iptuMensalBRL)}`
          : "") +
        ` = R$${listing.monthlyTotalBRL}/mês`,
    );

    if (benchmark.medianPricePerM2 !== null && attributes.areaM2) {
      parts.push(
        `mediana ${benchmark.label}: R$${benchmark.medianPricePerM2}/m² × ${attributes.areaM2}m² = R$${Math.round(fair)}`,
      );
    } else {
      parts.push(`referência ${benchmark.label}: R$${Math.round(fair)}/mês`);
    }

    if (benchmark.sampleSize > 0) {
      parts.push(`n=${benchmark.sampleSize}`);
    }

    const sign = deltaPercent > 0 ? "+" : "";
    parts.push(`→ ${sign}${deltaPercent.toFixed(1)}%`);

    return parts.join(" · ");
  }

  private toKey(listing: RentalListing): BenchmarkKey {
    return {
      cidade: listing.attributes.cidade,
      bairro: listing.attributes.bairro,
      quartos: listing.attributes.quartos,
      tipo: listing.attributes.tipo,
      areaM2: listing.attributes.areaM2,
    };
  }

  private tally(
    summary: RunSummary,
    classification: RentalRating["classification"],
  ): void {
    if (classification === "good_deal") summary.good += 1;
    else if (classification === "fair") summary.fair += 1;
    else summary.overpriced += 1;
  }
}
