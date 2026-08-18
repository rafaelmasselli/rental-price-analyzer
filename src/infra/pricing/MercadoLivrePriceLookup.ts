import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "playwright";
import { load, type CheerioAPI } from "cheerio";
import type {
  ComponentPriceQuote,
  IComponentPriceLookup,
} from "../../core/ports/index.js";
import { PriceCacheStore } from "./PriceCacheStore.js";

chromium.use(StealthPlugin());

export interface MercadoLivrePriceLookupOptions {
  cacheRoot?: string;
  cacheTtlMs?: number;
  navigationTimeoutMs?: number;
  delayBetweenLookupsMs?: { min: number; max: number };
  minSampleSize?: number;
  headless?: boolean;
}

export class MercadoLivrePriceLookup implements IComponentPriceLookup {
  private static readonly BASE_URL = "https://lista.mercadolivre.com.br";
  private static readonly USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  private readonly cache: PriceCacheStore;
  private readonly navigationTimeoutMs: number;
  private readonly delayRange: { min: number; max: number };
  private readonly minSampleSize: number;
  private readonly headless: boolean;
  private browser: Browser | null = null;
  private cacheLoaded = false;

  constructor(options: MercadoLivrePriceLookupOptions = {}) {
    this.cache = new PriceCacheStore(options.cacheRoot, options.cacheTtlMs);
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
    this.delayRange = options.delayBetweenLookupsMs ?? { min: 600, max: 1800 };
    this.minSampleSize = options.minSampleSize ?? 3;
    this.headless = options.headless ?? true;
  }

  async lookup(
    spec: string,
    category: string,
  ): Promise<ComponentPriceQuote | null> {
    await this.ensureCacheLoaded();

    const cached = this.cache.get(category, spec);
    if (cached !== undefined) {
      if (cached) {
        console.log(
          `[ML] cache hit "${spec}" → R$${cached.medianPriceBRL} (n=${cached.sampleSize})`,
        );
      } else {
        console.log(`[ML] cache hit "${spec}" → null (previously not found)`);
      }
      return cached;
    }

    const browser = await this.getBrowser();
    const quote = await this.fetchQuote(browser, spec, category);
    await this.cache.set(category, spec, quote);
    await this.randomSleep();
    return quote;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (this.cacheLoaded) return;
    await this.cache.load();
    this.cacheLoaded = true;
    console.log(`[ML] Cache loaded with ${this.cache.size()} entries.`);
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    console.log(`[ML] Launching Chromium for Mercado Livre lookups...`);
    this.browser = (await chromium.launch({
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    })) as Browser;
    return this.browser;
  }

  private async fetchQuote(
    browser: Browser,
    spec: string,
    category: string,
  ): Promise<ComponentPriceQuote | null> {
    const urls = this.candidateUrls(spec);

    for (const url of urls) {
      console.log(`[ML] GET ${url}`);
      try {
        const html = await this.fetchPage(browser, url);
        if (!html) continue;

        const prices = this.extractPrices(html, spec);
        if (prices.length < this.minSampleSize) continue;

        const median = this.median(prices);
        console.log(
          `[ML] "${spec}" → R$${Math.round(median)} (n=${prices.length})`,
        );
        return {
          spec,
          category,
          medianPriceBRL: Math.round(median),
          sampleSize: prices.length,
          sourceUrl: url,
        };
      } catch (error) {
        console.log(`[ML] "${spec}" failed: ${(error as Error).message}`);
      }
    }

    console.log(`[ML] "${spec}" → exhausted ${urls.length} URL strategies, no reliable data`);
    return null;
  }

  private candidateUrls(spec: string): string[] {
    const slug = this.toSlug(spec);
    const encoded = encodeURIComponent(spec.trim());
    return [
      `${MercadoLivrePriceLookup.BASE_URL}/${slug}_NoIndex_True`,
      `${MercadoLivrePriceLookup.BASE_URL}/${slug}`,
      `https://www.mercadolivre.com.br/jms/mlb/lgz/msl/search?as_word=${encoded}`,
    ];
  }

  private toSlug(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private async fetchPage(browser: Browser, url: string): Promise<string | null> {
    const context = await browser.newContext({
      userAgent: MercadoLivrePriceLookup.USER_AGENT,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(this.navigationTimeoutMs);

    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (!response) {
        console.log(`[ML] no response object`);
        return null;
      }
      const status = response.status();
      if (status >= 400) {
        console.log(`[ML] HTTP ${status}`);
        return null;
      }

      await page
        .waitForSelector(
          ".ui-search-layout, .poly-card, .ui-search-no-results, .ui-search-rescue",
          { timeout: 12_000 },
        )
        .catch(() => undefined);
      await page
        .waitForLoadState("networkidle", { timeout: 4_000 })
        .catch(() => undefined);

      const html = await page.content();
      console.log(`[ML] HTTP ${status} (${html.length} bytes)`);
      return html;
    } finally {
      await context.close();
    }
  }

  private extractPrices(html: string, spec: string): number[] {
    const $ = load(html);
    const tokens = this.tokenize(spec);

    const cards = $(".ui-search-layout__item");
    const allPriceSpans = $(".andes-money-amount__fraction");
    const polyCards = $(".poly-card");

    const prices: number[] = [];
    cards.each((_, element) => {
      const card = $(element);
      const title = card.find(".ui-search-item__title, h2").first().text();
      if (!this.titleMatchesSpec(title, tokens)) return;
      const price = this.parseCardPrice(card.find(".andes-money-amount__fraction").first().text());
      if (price !== null) prices.push(price);
    });

    if (prices.length === 0) {
      polyCards.each((_, element) => {
        const card = $(element);
        const title = card.find(".poly-component__title, h3").first().text();
        if (!this.titleMatchesSpec(title, tokens)) return;
        const price = this.parseCardPrice(card.find(".andes-money-amount__fraction").first().text());
        if (price !== null) prices.push(price);
      });
    }

    if (prices.length === 0) {
      allPriceSpans.each((_, element) => {
        const value = this.parseCardPrice($(element).text());
        if (value !== null) prices.push(value);
      });
    }

    console.log(
      `[ML]   cards: ${cards.length} | poly-cards: ${polyCards.length} | total price spans: ${allPriceSpans.length} | extracted: ${prices.length}`,
    );

    if (prices.length === 0 && allPriceSpans.length === 0) {
      const title = $("title").text().trim();
      const noResults = $(".ui-search-rescue, .ui-search-no-results").length;
      console.log(
        `[ML]   debug: title="${title}" no-results-block=${noResults} html-len=${html.length}`,
      );
    }

    return this.trim(prices);
  }

  private parseCardPrice(text: string): number | null {
    const cleaned = text.replace(/[^\d]/g, "");
    if (!cleaned) return null;
    const value = Number.parseInt(cleaned, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private titleMatchesSpec(title: string, tokens: string[]): boolean {
    if (tokens.length === 0) return true;
    const lowered = title.toLowerCase();
    return tokens.every((token) => lowered.includes(token));
  }

  private tokenize(spec: string): string[] {
    return spec
      .toLowerCase()
      .split(/[\s\-_/+,]+/)
      .filter((token) => token.length >= 2);
  }

  private trim(prices: number[]): number[] {
    if (prices.length < 6) return prices;
    const sorted = [...prices].sort((a, b) => a - b);
    const lower = Math.floor(sorted.length * 0.15);
    const upper = Math.ceil(sorted.length * 0.85);
    return sorted.slice(lower, upper);
  }

  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private async randomSleep(): Promise<void> {
    const ms =
      Math.floor(Math.random() * (this.delayRange.max - this.delayRange.min + 1)) +
      this.delayRange.min;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
