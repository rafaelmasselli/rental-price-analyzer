import type { ILLMProvider, IRentalAgent } from "../../../ports/index.js";
import {
  withMonthlyTotal,
  type RentalAttributes,
  type RentalGraphState,
  type RentalListing,
} from "../../../../shared/models/index.js";
import { buildRentalNormalizationPrompt } from "./prompt.js";
import {
  rentalNormalizationSchema,
  type RentalNormalizationOutput,
} from "./schema.js";

type Normalized = RentalNormalizationOutput["listings"][number];

export interface RentalNormalizationOptions {
  batchSize?: number;
  maxAttempts?: number;
}

export class RentalNormalizationAgent implements IRentalAgent {
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;
  private static readonly INITIAL_BACKOFF_MS = 2000;

  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly prompt: ReturnType<typeof buildRentalNormalizationPrompt>;

  constructor(
    private readonly llmProvider: ILLMProvider,
    options: RentalNormalizationOptions = {},
  ) {
    const profile = llmProvider.getProfile();
    this.batchSize = options.batchSize ?? profile.batchSize;
    this.maxAttempts =
      options.maxAttempts ?? RentalNormalizationAgent.DEFAULT_MAX_ATTEMPTS;
    this.prompt = buildRentalNormalizationPrompt(profile.promptStyle);
  }

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    if (state.rawListings.length === 0) return { rawListings: [] };

    const batches = this.chunk(state.rawListings, this.batchSize);
    console.log(
      `\n[RentalNormalizationAgent] Normalizing ${state.rawListings.length} listings in ${batches.length} batch(es)...`,
    );

    const normalized = new Map<string, Normalized>();
    for (let i = 0; i < batches.length; i++) {
      console.log(
        `[RentalNormalizationAgent] Batch ${i + 1}/${batches.length} (${batches[i].length} listings)...`,
      );
      const result = await this.normalizeBatchWithRetry(state, batches[i]);
      for (const [id, entry] of result) normalized.set(id, entry);
    }

    let irrelevant = 0;
    let untouched = 0;
    const kept: RentalListing[] = [];

    for (const listing of state.rawListings) {
      const entry = normalized.get(listing.listingId);

      if (!entry) {
        untouched += 1;
        kept.push(listing);
        continue;
      }
      if (entry.classification === "irrelevant") {
        irrelevant += 1;
        continue;
      }

      kept.push(
        withMonthlyTotal({
          ...listing,
          attributes: this.merge(listing.attributes, entry.attributes),
        }),
      );
    }

    console.log(
      `[RentalNormalizationAgent] Kept ${kept.length} · dropped ${irrelevant} irrelevant · ${untouched} passed through unnormalized.`,
    );
    console.log(
      `[RentalNormalizationAgent] Coverage: ${this.coverage(kept, (a) => a.areaM2 !== null)}% area · ` +
        `${this.coverage(kept, (a) => a.quartos !== null)}% quartos · ` +
        `${this.coverage(kept, (a) => a.condominioBRL !== null)}% condomínio · ` +
        `${this.coverage(kept, (a) => a.bairro !== null)}% bairro`,
    );

    return { rawListings: kept };
  }

  /** Portal value wins; the LLM only fills what was null. */
  private merge(
    portal: RentalAttributes,
    llm: Normalized["attributes"],
  ): RentalAttributes {
    return {
      tipo: portal.tipo !== "outro" ? portal.tipo : llm.tipo,
      areaM2: portal.areaM2 ?? this.positive(llm.areaM2),
      quartos: portal.quartos ?? this.nonNegativeInt(llm.quartos),
      suites: portal.suites ?? this.nonNegativeInt(llm.suites),
      banheiros: portal.banheiros ?? this.nonNegativeInt(llm.banheiros),
      vagas: portal.vagas ?? this.nonNegativeInt(llm.vagas),
      condominioBRL: portal.condominioBRL ?? this.positive(llm.condominioBRL),
      iptuMensalBRL: portal.iptuMensalBRL ?? this.positive(llm.iptuMensalBRL),
      bairro: portal.bairro ?? this.text(llm.bairro),
      cidade: portal.cidade ?? this.text(llm.cidade),
      uf: portal.uf,
      andar: portal.andar,
      mobiliado: portal.mobiliado ?? llm.mobiliado,
      aceitaPet: portal.aceitaPet ?? llm.aceitaPet,
    };
  }

  private async normalizeBatchWithRetry(
    state: RentalGraphState,
    batch: RentalListing[],
  ): Promise<Map<string, Normalized>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.normalizeBatch(state, batch);
      } catch (error) {
        lastError = error;
        console.log(
          `[RentalNormalizationAgent] Attempt ${attempt}/${this.maxAttempts} failed: ${(error as Error).message}`,
        );
        if (attempt < this.maxAttempts) {
          const backoff =
            RentalNormalizationAgent.INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.log(`[RentalNormalizationAgent] Retrying in ${backoff}ms...`);
          await this.sleep(backoff);
        }
      }
    }

    console.log(
      `[RentalNormalizationAgent] Batch failed permanently (${(lastError as Error)?.message}). Listings pass through with portal data only.`,
    );
    return new Map();
  }

  private async normalizeBatch(
    state: RentalGraphState,
    batch: RentalListing[],
  ): Promise<Map<string, Normalized>> {
    const chain = this.prompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(rentalNormalizationSchema),
    );

    const payload = batch.map((listing) => ({
      listingId: listing.listingId,
      title: listing.title,
      rentBRL: listing.rentBRL,
      location: listing.location,
      category: listing.category,
      attributes: listing.attributes,
    }));

    const response = (await chain.invoke({
      query: state.query,
      variations: state.expandedQueries.join(" | "),
      listings: JSON.stringify(payload, null, 2),
    })) as RentalNormalizationOutput;

    const byId = new Map<string, Normalized>();
    for (const item of response.listings) byId.set(item.listingId, item);
    return byId;
  }

  private coverage(
    listings: RentalListing[],
    predicate: (attributes: RentalAttributes) => boolean,
  ): number {
    if (listings.length === 0) return 0;
    const hits = listings.filter((l) => predicate(l.attributes)).length;
    return Math.round((hits / listings.length) * 100);
  }

  private positive(value: number | null): number | null {
    return value !== null && Number.isFinite(value) && value > 0 ? value : null;
  }

  private nonNegativeInt(value: number | null): number | null {
    if (value === null || !Number.isFinite(value) || value < 0) return null;
    return Math.round(value);
  }

  private text(value: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      result.push(items.slice(i, i + size));
    }
    return result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
