import type { ILLMProvider, IRentalAgent } from "../../../ports/index.js";
import type { RentalGraphState } from "../../../../shared/models/index.js";
import {
  expansionSchema,
  type ExpansionSchemaOutput,
} from "../../../agents/expansion/schema.js";
import { buildRentalExpansionPrompt } from "./prompt.js";

export interface RentalQueryExpansionOptions {
  count: number;
}

export class RentalQueryExpansionAgent implements IRentalAgent {
  private readonly prompt: ReturnType<typeof buildRentalExpansionPrompt>;

  constructor(
    private readonly llmProvider: ILLMProvider,
    private readonly options: RentalQueryExpansionOptions,
  ) {
    this.prompt = buildRentalExpansionPrompt(llmProvider.getProfile().promptStyle);
  }

  async run(state: RentalGraphState): Promise<Partial<RentalGraphState>> {
    if (!state.query?.trim()) {
      throw new Error("RentalQueryExpansionAgent: empty query");
    }

    if (state.expandedQueries.length > 0) {
      const normalized = this.normalize(state.query, state.expandedQueries);
      console.log(
        `\n[RentalQueryExpansionAgent] Using ${normalized.length} manual variation(s), skipping LLM expansion.`,
      );
      return { expandedQueries: normalized };
    }

    if (this.options.count <= 1) {
      return { expandedQueries: [state.query.trim()] };
    }

    console.log(
      `\n[RentalQueryExpansionAgent] Expanding "${state.query}" into ${this.options.count} variations...`,
    );

    const chain = this.prompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(expansionSchema),
    );

    const response = (await chain.invoke({
      query: state.query,
      count: this.options.count,
    })) as ExpansionSchemaOutput;

    const expanded = this.normalize(state.query, response.queries);
    console.log(
      `[RentalQueryExpansionAgent] Variations: ${expanded.join(" | ")}`,
    );

    return { expandedQueries: expanded };
  }

  private normalize(originalQuery: string, raw: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const candidate of [originalQuery, ...raw]) {
      const trimmed = candidate.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
    }
    return result.slice(0, this.options.count);
  }
}
