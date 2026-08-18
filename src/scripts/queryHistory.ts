import { CredentialsLoader } from "../config/index.js";
import { VertexEmbeddingsProvider } from "../infra/llm/index.js";
import {
  HistoryQueryService,
  type HistoryQueryFilters,
  type HistoryRating,
} from "../infra/storage/index.js";
import { HistoryReportRenderer } from "../presentation/index.js";

const VALID_RATINGS: HistoryRating[] = ["good_deal", "fair", "overpriced"];

function printUsageAndExit(): never {
  console.log(`Usage: npm run query -- [options]

Options:
  --rating <good_deal|fair|overpriced>   Filter by rating classification
  --query <text>                          Filter by original search query
  --days <n>                              Only listings seen in the last N days
  --min-price <n>                         Minimum price (BRL)
  --max-price <n>                         Maximum price (BRL)
  --similar <text>                        Semantic search: re-rank by similarity to the given text
  --limit <n>                             Max results (default 20)
  --help                                  Show this help

Examples:
  npm run query -- --rating good_deal --days 7
  npm run query -- --query "kit am5" --rating good_deal
  npm run query -- --similar "memoria ram ddr5 6000" --rating good_deal --limit 10
  npm run query -- --max-price 2000 --rating good_deal
`);
  process.exit(0);
}

function parseArgs(argv: string[]): HistoryQueryFilters {
  const filters: HistoryQueryFilters = { limit: 20 };

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
          console.error(
            `Invalid --rating value "${next}". Use: ${VALID_RATINGS.join(" | ")}`,
          );
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

  const embeddings = filters.similarTo
    ? new VertexEmbeddingsProvider({
        serviceAccount: credentials.serviceAccount,
        location: credentials.location,
        model: credentials.embeddingModel,
      })
    : null;

  const service = new HistoryQueryService(
    credentials.historyDbPath,
    embeddings,
  );

  const results = await service.query(filters);
  new HistoryReportRenderer().render(filters, results);
}

main().catch((error) => {
  console.error("Query failed:", error);
  process.exit(1);
});
