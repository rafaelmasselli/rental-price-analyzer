import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface ServiceAccountCredentials {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
  universe_domain?: string;
}

export interface AiCredentials {
  serviceAccount: ServiceAccountCredentials;
  location: string;
  model: string;
  temperature: number;
  historyDbPath: string;
  embeddingModel: string;
  cacheRoot: string;
  maxListings: number;
  olxRegion: string;
  scraperDelayMinMs: number;
  scraperDelayMaxMs: number;
  scraperWarmup: boolean;
  scraperMaxRetries: number;
  queryExpansionCount: number;
  excludedCategories: string[];
  outlierMultiplier: number;
  minPrice: number;
  rentalDbPath: string;
  olxRentalRegion: string;
  rentalMaxListings: number;
  rentalQueryExpansionCount: number;
  rentalMinMonthlyTotal: number;
  rentalMaxMonthlyTotal: number;
  rentalExcludedKeywords: string[];
  rentalOutlierMultiplier: number;
  rentalThresholdPercent: number;
  benchmarkMinSample: number;
  benchmarkWindowDays: number;
}

interface RawCredentialsFile extends Partial<ServiceAccountCredentials> {
  location?: string;
  model?: string;
  temperature?: number;
  historyDbPath?: string;
  embeddingModel?: string;
  cacheRoot?: string;
  maxListings?: number;
  olxRegion?: string;
  scraperDelayMinMs?: number;
  scraperDelayMaxMs?: number;
  scraperWarmup?: boolean;
  scraperMaxRetries?: number;
  queryExpansionCount?: number;
  excludedCategories?: string[];
  outlierMultiplier?: number;
  minPrice?: number;
  rentalDbPath?: string;
  olxRentalRegion?: string;
  rentalMaxListings?: number;
  rentalQueryExpansionCount?: number;
  rentalMinMonthlyTotal?: number;
  rentalMaxMonthlyTotal?: number;
  rentalExcludedKeywords?: string[];
  rentalOutlierMultiplier?: number;
  rentalThresholdPercent?: number;
  benchmarkMinSample?: number;
  benchmarkWindowDays?: number;
}

export class CredentialsLoader {
  private static readonly FILE_NAME = "ia-credentials.json";
  private static readonly EXAMPLE_FILE_NAME = "ia-credentials.example.json";

  private static readonly REQUIRED_SERVICE_ACCOUNT_FIELDS = [
    "type",
    "project_id",
    "private_key",
    "client_email",
  ] as const;

  private static readonly DEFAULTS = {
    location: "us-central1",
    model: "gemini-2.0-flash-001",
    temperature: 0.2,
    historyDbPath: "data/history.sqlite",
    embeddingModel: "text-multilingual-embedding-002",
    cacheRoot: "data/cache/components",
    maxListings: 30,
    olxRegion: "brasil",
    scraperDelayMinMs: 1200,
    scraperDelayMaxMs: 3500,
    scraperWarmup: true,
    scraperMaxRetries: 2,
    queryExpansionCount: 4,
    excludedCategories: ["olx pay", "olx play"],
    outlierMultiplier: 3,
    minPrice: 50,
    rentalDbPath: "data/rentals.sqlite",
    olxRentalRegion: "estado-sp",
    rentalMaxListings: 50,
    rentalQueryExpansionCount: 3,
    rentalMinMonthlyTotal: 300,
    rentalMaxMonthlyTotal: 50000,
    rentalExcludedKeywords: [
      "temporada",
      "diaria",
      "diária",
      "por dia",
      "vende-se",
      "vendo ",
      "venda",
      "vaga de garagem",
    ],
    rentalOutlierMultiplier: 2.5,
    rentalThresholdPercent: 12,
    benchmarkMinSample: 5,
    benchmarkWindowDays: 45,
  };

  constructor(private readonly cwd: string = process.cwd()) {}

  async load(): Promise<AiCredentials> {
    const path = resolve(this.cwd, CredentialsLoader.FILE_NAME);
    const raw = await this.readFileOrThrow(path);
    const parsed = this.parseJsonOrThrow(raw, path);

    const serviceAccount = this.extractServiceAccount(parsed);

    return {
      serviceAccount,
      location: parsed.location ?? CredentialsLoader.DEFAULTS.location,
      model: parsed.model ?? CredentialsLoader.DEFAULTS.model,
      temperature: parsed.temperature ?? CredentialsLoader.DEFAULTS.temperature,
      historyDbPath:
        parsed.historyDbPath ?? CredentialsLoader.DEFAULTS.historyDbPath,
      embeddingModel:
        parsed.embeddingModel ?? CredentialsLoader.DEFAULTS.embeddingModel,
      cacheRoot: parsed.cacheRoot ?? CredentialsLoader.DEFAULTS.cacheRoot,
      maxListings: parsed.maxListings ?? CredentialsLoader.DEFAULTS.maxListings,
      olxRegion: parsed.olxRegion ?? CredentialsLoader.DEFAULTS.olxRegion,
      scraperDelayMinMs:
        parsed.scraperDelayMinMs ??
        CredentialsLoader.DEFAULTS.scraperDelayMinMs,
      scraperDelayMaxMs:
        parsed.scraperDelayMaxMs ??
        CredentialsLoader.DEFAULTS.scraperDelayMaxMs,
      scraperWarmup:
        parsed.scraperWarmup ?? CredentialsLoader.DEFAULTS.scraperWarmup,
      scraperMaxRetries:
        parsed.scraperMaxRetries ??
        CredentialsLoader.DEFAULTS.scraperMaxRetries,
      queryExpansionCount:
        parsed.queryExpansionCount ??
        CredentialsLoader.DEFAULTS.queryExpansionCount,
      excludedCategories:
        parsed.excludedCategories ??
        CredentialsLoader.DEFAULTS.excludedCategories,
      outlierMultiplier:
        parsed.outlierMultiplier ??
        CredentialsLoader.DEFAULTS.outlierMultiplier,
      minPrice: parsed.minPrice ?? CredentialsLoader.DEFAULTS.minPrice,
      rentalDbPath:
        parsed.rentalDbPath ?? CredentialsLoader.DEFAULTS.rentalDbPath,
      olxRentalRegion:
        parsed.olxRentalRegion ?? CredentialsLoader.DEFAULTS.olxRentalRegion,
      rentalMaxListings:
        parsed.rentalMaxListings ?? CredentialsLoader.DEFAULTS.rentalMaxListings,
      rentalQueryExpansionCount:
        parsed.rentalQueryExpansionCount ??
        CredentialsLoader.DEFAULTS.rentalQueryExpansionCount,
      rentalMinMonthlyTotal:
        parsed.rentalMinMonthlyTotal ??
        CredentialsLoader.DEFAULTS.rentalMinMonthlyTotal,
      rentalMaxMonthlyTotal:
        parsed.rentalMaxMonthlyTotal ??
        CredentialsLoader.DEFAULTS.rentalMaxMonthlyTotal,
      rentalExcludedKeywords:
        parsed.rentalExcludedKeywords ??
        CredentialsLoader.DEFAULTS.rentalExcludedKeywords,
      rentalOutlierMultiplier:
        parsed.rentalOutlierMultiplier ??
        CredentialsLoader.DEFAULTS.rentalOutlierMultiplier,
      rentalThresholdPercent:
        parsed.rentalThresholdPercent ??
        CredentialsLoader.DEFAULTS.rentalThresholdPercent,
      benchmarkMinSample:
        parsed.benchmarkMinSample ??
        CredentialsLoader.DEFAULTS.benchmarkMinSample,
      benchmarkWindowDays:
        parsed.benchmarkWindowDays ??
        CredentialsLoader.DEFAULTS.benchmarkWindowDays,
    };
  }

  private async readFileOrThrow(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        //
        throw new Error(
          `Missing ${CredentialsLoader.FILE_NAME}. Copy ${CredentialsLoader.EXAMPLE_FILE_NAME} to ${CredentialsLoader.FILE_NAME} and fill in your GCP service account JSON.`,
        );
      }
      throw error;
    }
  }

  private parseJsonOrThrow(raw: string, path: string): RawCredentialsFile {
    try {
      return JSON.parse(raw) as RawCredentialsFile;
    } catch (error) {
      throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`);
    }
  }

  private extractServiceAccount(
    parsed: RawCredentialsFile,
  ): ServiceAccountCredentials {
    const missing = CredentialsLoader.REQUIRED_SERVICE_ACCOUNT_FIELDS.filter(
      (field) => !parsed[field],
    );

    if (missing.length > 0) {
      throw new Error(
        `${CredentialsLoader.FILE_NAME} is not a valid GCP service account JSON. Missing fields: ${missing.join(", ")}.`,
      );
    }

    if (parsed.project_id?.startsWith("YOUR_")) {
      throw new Error(
        `${CredentialsLoader.FILE_NAME} still contains placeholder values. Replace them with your real service account JSON from the GCP console.`,
      );
    }

    return {
      type: parsed.type!,
      project_id: parsed.project_id!,
      private_key_id: parsed.private_key_id ?? "",
      private_key: parsed.private_key!,
      client_email: parsed.client_email!,
      client_id: parsed.client_id ?? "",
      auth_uri: parsed.auth_uri,
      token_uri: parsed.token_uri,
      auth_provider_x509_cert_url: parsed.auth_provider_x509_cert_url,
      client_x509_cert_url: parsed.client_x509_cert_url,
      universe_domain: parsed.universe_domain,
    };
  }
}
