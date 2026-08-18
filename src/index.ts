import { CredentialsLoader } from "./config/index.js";
import {
  AnalysisAgent,
  HistoryAgent,
  QueryExpansionAgent,
  RatingAgent,
  SanitizationAgent,
  SearchAgent,
} from "./core/agents/index.js";
import { Pipeline } from "./core/pipeline/index.js";
import { LlmFactory } from "./infra/llm/index.js";
import { MercadoLivrePriceLookup } from "./infra/pricing/index.js";
import { OlxScraper } from "./infra/sources/index.js";
import { SqlitePriceHistoryStore } from "./infra/storage/index.js";
import { ReportRenderer } from "./presentation/index.js";

interface CliInput {
  query: string;
  manualVariations: string[];
}

function parseInput(): CliInput {
  const raw = process.argv.slice(2).join(" ").trim();
  if (!raw) {
    return { query: "iphone 13", manualVariations: [] };
  }

  if (raw.includes("|")) {
    const parts = raw
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 1) {
      return { query: parts[0], manualVariations: parts };
    }
  }

  return { query: raw, manualVariations: [] };
}

async function bootstrap(): Promise<void> {
  const credentials = await new CredentialsLoader().load();

  const factory = new LlmFactory(credentials);
  const llmProvider = factory.createLlm();
  const embeddingsProvider = factory.createEmbeddings();

  const listingSource = new OlxScraper({
    region: credentials.olxRegion,
    maxListings: credentials.maxListings,
    delay: {
      minMs: credentials.scraperDelayMinMs,
      maxMs: credentials.scraperDelayMaxMs,
    },
    warmup: credentials.scraperWarmup,
    maxRetries: credentials.scraperMaxRetries,
  });

  const historyStore = new SqlitePriceHistoryStore(credentials.historyDbPath);
  const priceLookup = new MercadoLivrePriceLookup({
    cacheRoot: credentials.cacheRoot,
  });

  const pipeline = new Pipeline({
    expansion: new QueryExpansionAgent(llmProvider, {
      count: credentials.queryExpansionCount,
    }),
    search: new SearchAgent(listingSource),
    sanitization: new SanitizationAgent({
      excludedCategories: credentials.excludedCategories,
      outlierMultiplier: credentials.outlierMultiplier,
      minPrice: credentials.minPrice,
    }),
    rating: new RatingAgent(llmProvider, priceLookup),
    history: new HistoryAgent(historyStore, embeddingsProvider),
    analysis: new AnalysisAgent(llmProvider),
  });

  try {
    const { query, manualVariations } = parseInput();
    const finalState = await pipeline.run(query, manualVariations);
    new ReportRenderer().render(finalState);
  } finally {
    await priceLookup.close();
  }
}

bootstrap().catch((error) => {
  console.error("Investigation failed:", error);
  process.exit(1);
});
