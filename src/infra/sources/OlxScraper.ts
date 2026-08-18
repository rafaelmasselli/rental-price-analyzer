import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";
import { load, type CheerioAPI } from "cheerio";
import type { IListingSource } from "../../core/ports/index.js";
import type { Listing } from "../../shared/models/index.js";

chromium.use(StealthPlugin());

export interface DelayRange {
  minMs: number;
  maxMs: number;
}

export interface OlxScraperOptions {
  region: string;
  maxListings: number;
  delay?: DelayRange;
  warmup?: boolean;
  maxRetries?: number;
  headless?: boolean;
  navigationTimeoutMs?: number;
}

interface NextDataAd {
  listId?: number | string;
  subject?: string;
  title?: string;
  price?: string;
  priceValue?: number;
  url?: string;
  location?: { municipality?: string; uf?: string };
  category?: { name?: string };
  publishedAt?: string;
  date?: string;
}

export class OlxScraper implements IListingSource {
  private static readonly BASE_URL = "https://www.olx.com.br";

  private static readonly DEFAULT_DELAY: DelayRange = {
    minMs: 1200,
    maxMs: 3500,
  };

  private static readonly DEFAULT_MAX_RETRIES = 2;
  private static readonly DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;

  private static readonly USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  private readonly delay: DelayRange;
  private readonly warmup: boolean;
  private readonly maxRetries: number;
  private readonly headless: boolean;
  private readonly navigationTimeoutMs: number;

  constructor(private readonly options: OlxScraperOptions) {
    this.delay = options.delay ?? OlxScraper.DEFAULT_DELAY;
    this.warmup = options.warmup ?? true;
    this.maxRetries = options.maxRetries ?? OlxScraper.DEFAULT_MAX_RETRIES;
    this.headless = options.headless ?? true;
    this.navigationTimeoutMs =
      options.navigationTimeoutMs ?? OlxScraper.DEFAULT_NAVIGATION_TIMEOUT_MS;
  }

  async search(query: string): Promise<Listing[]> {
    return this.searchMany([query]);
  }

  async searchMany(queries: string[]): Promise<Listing[]> {
    if (queries.length === 0) return [];

    const browser = await this.launchBrowser();
    const collected: Listing[] = [];

    try {
      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        const useWarmup = this.warmup && i === 0;

        try {
          const items = await this.searchOne(browser, query, useWarmup);
          console.log(
            `[OlxScraper] Query "${query}" → ${items.length} listings`,
          );
          collected.push(...items);
        } catch (error) {
          console.log(
            `[OlxScraper] Query "${query}" failed: ${(error as Error).message}`,
          );
        }

        if (i < queries.length - 1) {
          await this.randomSleep("between queries");
        }
      }
      return collected;
    } finally {
      await browser.close();
    }
  }

  private async searchOne(
    browser: Browser,
    query: string,
    useWarmup: boolean,
  ): Promise<Listing[]> {
    const html = await this.fetchHtmlWithRetry(browser, query, useWarmup);
    const $ = load(html);

    const fromNext = this.fromNextData($);
    if (fromNext.length > 0) return fromNext;

    const fromHtml = this.fromHtmlFallback($);
    if (fromHtml.length > 0) return fromHtml;

    return [];
  }

  private async launchBrowser(): Promise<Browser> {
    return (await chromium.launch({
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    })) as Browser;
  }

  private async fetchHtmlWithRetry(
    browser: Browser,
    query: string,
    useWarmup: boolean,
  ): Promise<string> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      try {
        return await this.fetchHtmlOnce(browser, query, useWarmup);
      } catch (error) {
        lastError = error;
        if (attempt > this.maxRetries) break;
        const backoff = this.computeBackoff(attempt);
        console.log(
          `[OlxScraper] Attempt ${attempt} failed (${(error as Error).message}). Retrying in ${backoff}ms...`,
        );
        await this.sleep(backoff);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`OLX request failed after ${this.maxRetries + 1} attempts`);
  }

  private async fetchHtmlOnce(
    browser: Browser,
    query: string,
    useWarmup: boolean,
  ): Promise<string> {
    const context = await this.createContext(browser);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(this.navigationTimeoutMs);

    try {
      if (useWarmup) {
        console.log("[OlxScraper] Warmup: visiting homepage...");
        await page.goto(OlxScraper.BASE_URL, { waitUntil: "domcontentloaded" });
        await this.randomSleep("between warmup and search");
      }

      const searchUrl = this.buildSearchUrl(query);
      console.log(`[OlxScraper] Navigating to ${searchUrl}`);
      const response = await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
      });

      if (!response) {
        throw new Error("OLX request failed: no response");
      }
      if (!response.ok()) {
        throw new Error(`OLX request failed: HTTP ${response.status()}`);
      }

      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => undefined);
      return await page.content();
    } finally {
      await context.close();
    }
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({
      userAgent: OlxScraper.USER_AGENT,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
  }

  private buildSearchUrl(query: string): string {
    const encoded = encodeURIComponent(query.trim());
    return `${OlxScraper.BASE_URL}/${this.options.region}?q=${encoded}`;
  }

  private computeBackoff(attempt: number): number {
    return this.delay.maxMs * Math.pow(2, attempt - 1);
  }

  private async randomSleep(reason: string): Promise<void> {
    const ms = this.pickInRange(this.delay.minMs, this.delay.maxMs);
    console.log(`[OlxScraper] Sleeping ${ms}ms (${reason})...`);
    await this.sleep(ms);
  }

  private pickInRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private fromNextData($: CheerioAPI): Listing[] {
    const scriptContent = $("#__NEXT_DATA__").html();
    if (!scriptContent) return [];

    const parsed = JSON.parse(scriptContent);
    const ads: NextDataAd[] =
      parsed?.props?.pageProps?.ads ??
      parsed?.props?.pageProps?.initialState?.ads?.list ??
      [];

    return ads
      .slice(0, this.options.maxListings)
      .map((ad) => this.toListing(ad))
      .filter((listing): listing is Listing => listing !== null);
  }

  private fromHtmlFallback($: CheerioAPI): Listing[] {
    const results: Listing[] = [];

    $("a[data-ds-component='DS-AdCard']").each((_, element) => {
      if (results.length >= this.options.maxListings) return false;
      const node = $(element);
      const url = node.attr("href") ?? "";
      const title = node.find("[data-ds-component='DS-AdCard-Title']").text().trim();
      const priceLabel = node.find("[data-ds-component='DS-AdCard-Price']").text().trim();
      const location = node.find("[data-ds-component='DS-AdCard-Location']").text().trim();
      const price = this.parsePriceLabel(priceLabel);

      if (!url || !title || price === null) return;

      results.push({
        listingId: this.extractListingId(url),
        title,
        price,
        currency: "BRL",
        url: url.startsWith("http") ? url : `${OlxScraper.BASE_URL}${url}`,
        location: location || "N/A",
      });
    });

    return results;
  }

  private toListing(ad: NextDataAd): Listing | null {
    const url = ad.url ?? "";
    const price = this.normalizePrice(ad.priceValue, ad.price);
    if (!url || price === null) return null;

    return {
      listingId: String(ad.listId ?? this.extractListingId(url)),
      title: (ad.subject ?? ad.title ?? "Untitled").trim(),
      price,
      currency: "BRL",
      url,
      location:
        [ad.location?.municipality, ad.location?.uf].filter(Boolean).join(" - ") ||
        "N/A",
      publishedAt: ad.publishedAt ?? ad.date,
      category: ad.category?.name,
    };
  }

  private normalizePrice(
    priceValue: number | undefined,
    priceLabel: string | undefined,
  ): number | null {
    if (
      typeof priceValue === "number" &&
      Number.isFinite(priceValue) &&
      priceValue > 0
    ) {
      return priceValue;
    }
    const parsed = this.parsePriceLabel(priceLabel);
    if (parsed !== null && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  }

  private extractListingId(url: string): string {
    const match = url.match(/-(\d+)(?:\?|$)/);
    if (match) return match[1];
    return Buffer.from(url).toString("base64url").slice(-16);
  }

  private parsePriceLabel(label: string | undefined): number | null {
    if (!label) return null;
    const digits = label.replace(/[^\d,]/g, "").replace(",", ".");
    const value = Number.parseFloat(digits);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
}
