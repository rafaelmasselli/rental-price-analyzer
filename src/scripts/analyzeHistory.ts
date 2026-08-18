import { CredentialsLoader } from "../config/index.js";
import { HistoricalAnalyzer } from "../core/services/index.js";
import { LlmFactory } from "../infra/llm/index.js";
import {
  HistoryQueryService,
  type HistoryQueryFilters,
  type HistoryRating,
} from "../infra/storage/index.js";
import { HistoricalAnalysisRenderer } from "../presentation/index.js";

const VALID_RATINGS: HistoryRating[] = ["good_deal", "fair", "overpriced"];
const DEFAULT_LIMIT = 60;

function printUsageAndExit(): never {
  console.log(`Usage: npm run analyze -- [options]

Options:
  --rating <good_deal|fair|overpriced>   Filter to a specific rating
  --query <text>                          Filter by original search query
  --days <n>                              Only listings seen in the last N days
  --min-price <n>                         Minimum price (BRL)
  --max-price <n>                         Maximum price (BRL)
  --similar <text>                        Focus the batch around a semantic theme
  --limit <n>                             Number of listings to analyze (default ${DEFAULT_LIMIT})
  --help                                  Show this help

Examples:
  npm run analyze
  npm run analyze -- --rating good_deal --days 30
  npm run analyze -- --query "kit am5" --limit 100
  npm run analyze -- --similar "ddr5 32gb 6000" --rating good_deal
`);
  process.exit(0);
}

function parseArgs(argv: string[]): HistoryQueryFilters {
  const filters: HistoryQueryFilters = { limit: DEFAULT_LIMIT };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];

    switch (flag) {
      case "--help":
      case "-h":
        printUsageAndExit();
      case "--rating":
        ensureValue(flag, next);
        if (!VALID_RATINGS.includes(next as HistoryRating)) {
          console.error(`Invalid --rating. Use: ${VALID_RATINGS.join(" | ")}`);
          process.exit(1);
        }
        filters.rating = next as HistoryRating;
        i++;
        break;
      case "--query":
        ensureValue(flag, next);
        filters.query = next;
        i++;
        break;
      case "--days":
        ensureValue(flag, next);
        filters.days = Number.parseInt(next, 10);
        i++;
        break;
      case "--min-price":
        ensureValue(flag, next);
        filters.minPrice = Number.parseFloat(next);
        i++;
        break;
      case "--max-price":
        ensureValue(flag, next);
        filters.maxPrice = Number.parseFloat(next);
        i++;
        break;
      case "--similar":
        ensureValue(flag, next);
        filters.similarTo = next;
        i++;
        break;
      case "--limit":
        ensureValue(flag, next);
        filters.limit = Number.parseInt(next, 10);
        i++;
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        printUsageAndExit();
    }
  }

  return filters;
}

function ensureValue(flag: string, value: string | undefined): void {
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${flag}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const filters = parseArgs(process.argv.slice(2));
  const credentials = await new CredentialsLoader().load();

  const factory = new LlmFactory(credentials);
  const llmProvider = factory.createLlm();
  const embeddings = filters.similarTo ? factory.createEmbeddings() : null;

  const queryService = new HistoryQueryService(
    credentials.historyDbPath,
    embeddings,
  );

  const analyzer = new HistoricalAnalyzer(llmProvider, queryService);
  console.log(`Analyzing history with Gemini...`);
  const result = await analyzer.analyze(filters);

  new HistoricalAnalysisRenderer().render(result, filters);
}

main().catch((error) => {
  console.error("Analyze failed:", error);
  process.exit(1);
});
