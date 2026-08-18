import type { IAgent, ILLMProvider } from "../../ports/index.js";
import type { GraphState } from "../../../shared/models/index.js";
import { expansionPrompt } from "./prompt.js";
import { expansionSchema, type ExpansionSchemaOutput } from "./schema.js";

export interface QueryExpansionOptions {
  count: number;
}

export class QueryExpansionAgent implements IAgent {
  constructor(
    private readonly llmProvider: ILLMProvider,
    private readonly options: QueryExpansionOptions,
  ) {}

  async run(state: GraphState): Promise<Partial<GraphState>> {
    if (!state.query?.trim()) {
      throw new Error("QueryExpansionAgent: empty query");
    }

    if (state.expandedQueries.length > 0) {
      const normalized = this.normalize(state.query, state.expandedQueries);
      console.log(
        `\n[QueryExpansionAgent] Using ${normalized.length} manual variation(s), skipping LLM expansion.`,
      );
      console.log(`[QueryExpansionAgent] Variations: ${normalized.join(" | ")}`);
      return { expandedQueries: normalized };
    }

    console.log(
      `\n[QueryExpansionAgent] Expanding "${state.query}" into ${this.options.count} variations...`,
    );

    const chain = expansionPrompt.pipe(
      this.llmProvider.getModel().withStructuredOutput(expansionSchema),
    );

    const response = (await chain.invoke({
      query: state.query,
      count: this.options.count,
    })) as ExpansionSchemaOutput;

    const expanded = this.normalize(state.query, response.queries);
    console.log(`[QueryExpansionAgent] Variations: ${expanded.join(" | ")}`);

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
