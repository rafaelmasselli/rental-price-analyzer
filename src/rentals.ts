import { CredentialsLoader } from "./config/index.js";
import {
  RentalAnalysisAgent,
  RentalBenchmarkAgent,
  RentalHistoryAgent,
  RentalNormalizationAgent,
  RentalPipeline,
  RentalQueryExpansionAgent,
  RentalRefineAgent,
  RentalSanitizationAgent,
  RentalSearchAgent,
} from "./core/rental/index.js";
import {
  GeminiProvider,
  VertexEmbeddingsProvider,
} from "./infra/llm/index.js";
import { NeighborhoodBenchmark } from "./infra/pricing/index.js";
import { OlxRentalScraper } from "./infra/sources/index.js";
import { SqliteRentalHistoryStore } from "./infra/storage/index.js";
import { RentalReportRenderer } from "./presentation/index.js";

interface CliInput {
  query: string;
  manualVariations: string[];
  region?: string;
}

function parseInput(): CliInput {
  const argv = process.argv.slice(2);
  const terms: string[] = [];
  let region: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--region" && argv[i + 1]) {
      region = argv[i + 1];
      i += 1;
      continue;
    }
    terms.push(argv[i]);
  }

  const raw = terms.join(" ").trim();
  if (!raw) {
    return { query: "apartamento 2 quartos", manualVariations: [], region };
  }

  if (raw.includes("|")) {
    const parts = raw
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 1) {
      return { query: parts[0], manualVariations: parts, region };
    }
  }

  return { query: raw, manualVariations: [], region };
}

async function bootstrap(): Promise<void> {
  const credentials = await new CredentialsLoader().load();
  const { query, manualVariations, region } = parseInput();

  const llmProvider = new GeminiProvider({
    serviceAccount: credentials.serviceAccount,
    location: credentials.location,
    model: credentials.model,
    temperature: credentials.temperature,
  });

  const embeddingsProvider = new VertexEmbeddingsProvider({
    serviceAccount: credentials.serviceAccount,
    location: credentials.location,
    model: credentials.embeddingModel,
  });

  const listingSource = new OlxRentalScraper({
    region: region ?? credentials.olxRentalRegion,
    maxListings: credentials.rentalMaxListings,
    delay: {
      minMs: credentials.scraperDelayMinMs,
      maxMs: credentials.scraperDelayMaxMs,
    },
    warmup: credentials.scraperWarmup,
    maxRetries: credentials.scraperMaxRetries,
  });

  const historyStore = new SqliteRentalHistoryStore(credentials.rentalDbPath);
  const benchmark = new NeighborhoodBenchmark({
    minSampleSize: credentials.benchmarkMinSample,
  });

  const pipeline = new RentalPipeline({
    expansion: new RentalQueryExpansionAgent(llmProvider, {
      count: credentials.rentalQueryExpansionCount,
    }),
    search: new RentalSearchAgent(listingSource),
    sanitization: new RentalSanitizationAgent({
      minMonthlyTotal: credentials.rentalMinMonthlyTotal,
      maxMonthlyTotal: credentials.rentalMaxMonthlyTotal,
      excludedKeywords: credentials.rentalExcludedKeywords,
    }),
    normalization: new RentalNormalizationAgent(llmProvider),
    refine: new RentalRefineAgent({
      outlierMultiplier: credentials.rentalOutlierMultiplier,
      minGroupSize: credentials.benchmarkMinSample,
    }),
    benchmark: new RentalBenchmarkAgent(benchmark, historyStore, llmProvider, {
      compWindowDays: credentials.benchmarkWindowDays,
      classificationThresholdPercent: credentials.rentalThresholdPercent,
    }),
    history: new RentalHistoryAgent(historyStore, embeddingsProvider),
    analysis: new RentalAnalysisAgent(llmProvider),
  });

  const finalState = await pipeline.run(query, manualVariations);
  new RentalReportRenderer().render(finalState);
}

bootstrap().catch((error) => {
  console.error("Rental investigation failed:", error);
  process.exit(1);
});
