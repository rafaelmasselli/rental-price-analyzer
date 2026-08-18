import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext } from "playwright";

chromium.use(StealthPlugin());

export interface FetcherDelayRange {
  minMs: number;
  maxMs: number;
}

export interface PlaywrightPageFetcherOptions {
  label: string;
  delay?: FetcherDelayRange;
  maxRetries?: number;
  headless?: boolean;
  navigationTimeoutMs?: number;
  userAgent?: string;
  /** Reuse an already installed Chrome/Chromium instead of Playwright's own. */
  executablePath?: string;
}

/**
 * Browser plumbing shared by the rental scrapers: stealth launch, one throwaway
 * context per request, randomized delays, exponential backoff on failure.
 */
export class PlaywrightPageFetcher {
  private static readonly DEFAULT_DELAY: FetcherDelayRange = {
    minMs: 1200,
    maxMs: 3500,
  };

  private static readonly DEFAULT_USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  private readonly label: string;
  private readonly delay: FetcherDelayRange;
  private readonly maxRetries: number;
  private readonly headless: boolean;
  private readonly navigationTimeoutMs: number;
  private readonly userAgent: string;
  private readonly executablePath: string | undefined;
  private browser: Browser | null = null;

  constructor(options: PlaywrightPageFetcherOptions) {
    this.label = options.label;
    this.delay = options.delay ?? PlaywrightPageFetcher.DEFAULT_DELAY;
    this.maxRetries = options.maxRetries ?? 2;
    this.headless = options.headless ?? true;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
    this.userAgent = options.userAgent ?? PlaywrightPageFetcher.DEFAULT_USER_AGENT;
    this.executablePath =
      options.executablePath ?? process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }

  async open(): Promise<void> {
    if (this.browser) return;
    this.browser = (await chromium.launch({
      headless: this.headless,
      executablePath: this.executablePath,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    })) as Browser;
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    await this.browser.close();
    this.browser = null;
  }

  async fetchHtml(url: string, warmupUrl?: string): Promise<string> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      attempt += 1;
      try {
        return await this.fetchOnce(url, warmupUrl);
      } catch (error) {
        lastError = error;
        if (attempt > this.maxRetries) break;
        const backoff = this.delay.maxMs * Math.pow(2, attempt - 1);
        console.log(
          `[${this.label}] Attempt ${attempt} failed (${(error as Error).message}). Retrying in ${backoff}ms...`,
        );
        await this.sleep(backoff);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${this.label}: request failed after ${this.maxRetries + 1} attempts`);
  }

  async randomSleep(reason: string): Promise<void> {
    const ms =
      Math.floor(Math.random() * (this.delay.maxMs - this.delay.minMs + 1)) +
      this.delay.minMs;
    console.log(`[${this.label}] Sleeping ${ms}ms (${reason})...`);
    await this.sleep(ms);
  }

  private async fetchOnce(url: string, warmupUrl?: string): Promise<string> {
    if (!this.browser) {
      throw new Error(`${this.label}: fetcher not opened`);
    }

    const context = await this.createContext(this.browser);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(this.navigationTimeoutMs);

    try {
      if (warmupUrl) {
        console.log(`[${this.label}] Warmup: visiting ${warmupUrl}...`);
        await page.goto(warmupUrl, { waitUntil: "domcontentloaded" });
        await this.randomSleep("between warmup and search");
      }

      console.log(`[${this.label}] Navigating to ${url}`);
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });

      if (!response) {
        throw new Error("no response");
      }
      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
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
      userAgent: this.userAgent,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
