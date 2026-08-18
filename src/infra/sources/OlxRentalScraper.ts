import { load, type CheerioAPI } from "cheerio";
import type { IRentalListingSource } from "../../core/ports/index.js";
import {
  EMPTY_RENTAL_ATTRIBUTES,
  computeMonthlyTotal,
  type RentalAttributes,
  type RentalListing,
  type RentalPropertyType,
} from "../../shared/models/index.js";
import {
  PlaywrightPageFetcher,
  type FetcherDelayRange,
} from "./PlaywrightPageFetcher.js";

export interface OlxRentalScraperOptions {
  /** OLX region slug, e.g. "estado-sp", "sp/sao-paulo", "brasil". */
  region: string;
  maxListings: number;
  delay?: FetcherDelayRange;
  warmup?: boolean;
  maxRetries?: number;
  headless?: boolean;
  navigationTimeoutMs?: number;
}

interface NextDataProperty {
  name?: string;
  label?: string;
  value?: string | number;
}

interface NextDataAd {
  listId?: number | string;
  subject?: string;
  title?: string;
  price?: string;
  priceValue?: number;
  url?: string;
  location?: {
    municipality?: string;
    neighbourhood?: string;
    uf?: string;
  };
  category?: { name?: string };
  publishedAt?: string;
  date?: string;
  properties?: NextDataProperty[];
}

export class OlxRentalScraper implements IRentalListingSource {
  private static readonly BASE_URL = "https://www.olx.com.br";
  private static readonly RENTAL_PATH = "imoveis/aluguel";

  /** Accepts OLX's internal field names and the human labels alike. */
  private static readonly FIELD_ALIASES: Record<string, string[]> = {
    areaM2: ["size", "area", "area util", "area total", "metragem", "tamanho"],
    quartos: ["rooms", "quartos", "dormitorios", "quartos/dormitorios"],
    suites: ["suites", "suite"],
    banheiros: ["bathrooms", "banheiros", "banheiro"],
    vagas: [
      "garage_spaces",
      "vagas",
      "vagas na garagem",
      "vaga",
      "garagem",
    ],
    condominioBRL: ["condominio", "valor do condominio", "condominio (r$)"],
    iptuMensalBRL: ["iptu", "valor do iptu", "iptu (r$)"],
    tipo: ["re_type", "tipo", "tipo de imovel", "categoria"],
    andar: ["floor", "andar"],
    mobiliado: ["furnished", "mobiliado", "mobilia"],
    aceitaPet: ["pets", "aceita pet", "aceita animais", "animais"],
  };

  private static readonly TYPE_KEYWORDS: Array<
    [RegExp, RentalPropertyType]
  > = [
    [/cobertura/, "cobertura"],
    [/kitnet|kitchenette|quitinete|conjugad/, "kitnet"],
    [/studio|estudio/, "studio"],
    [/sobrado/, "sobrado"],
    [/\bflat\b|apart hotel/, "flat"],
    [/casa|terrea|chacara|sitio/, "casa"],
    [/sala comercial|loja|galpao|escritorio|comercial|ponto/, "comercial"],
    [/apartamento|apto|\bap\b|apart/, "apartamento"],
  ];

  private readonly fetcher: PlaywrightPageFetcher;
  private readonly warmup: boolean;

  constructor(private readonly options: OlxRentalScraperOptions) {
    this.warmup = options.warmup ?? true;
    this.fetcher = new PlaywrightPageFetcher({
      label: "OlxRentalScraper",
      delay: options.delay,
      maxRetries: options.maxRetries,
      headless: options.headless,
      navigationTimeoutMs: options.navigationTimeoutMs,
    });
  }

  async search(query: string): Promise<RentalListing[]> {
    return this.searchMany([query]);
  }

  async searchMany(queries: string[]): Promise<RentalListing[]> {
    if (queries.length === 0) return [];

    await this.fetcher.open();
    const collected: RentalListing[] = [];

    try {
      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        const warmupUrl =
          this.warmup && i === 0 ? OlxRentalScraper.BASE_URL : undefined;

        try {
          const html = await this.fetcher.fetchHtml(
            this.buildSearchUrl(query),
            warmupUrl,
          );
          const items = this.parse(load(html));
          console.log(
            `[OlxRentalScraper] Query "${query}" → ${items.length} listings`,
          );
          collected.push(...items);
        } catch (error) {
          console.log(
            `[OlxRentalScraper] Query "${query}" failed: ${(error as Error).message}`,
          );
        }

        if (i < queries.length - 1) {
          await this.fetcher.randomSleep("between queries");
        }
      }
      return collected;
    } finally {
      await this.fetcher.close();
    }
  }

  private buildSearchUrl(query: string): string {
    const encoded = encodeURIComponent(query.trim());
    return `${OlxRentalScraper.BASE_URL}/${OlxRentalScraper.RENTAL_PATH}/${this.options.region}?q=${encoded}`;
  }

  private parse($: CheerioAPI): RentalListing[] {
    const fromCards = this.fromAdCards($);
    if (fromCards.length > 0) return fromCards;

      return this.fromNextData($);
  }

  private fromNextData($: CheerioAPI): RentalListing[] {
    const scriptContent = $("#__NEXT_DATA__").html();
    if (!scriptContent) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(scriptContent);
    } catch {
      return [];
    }

    const root = parsed as {
      props?: {
        pageProps?: {
          ads?: NextDataAd[];
          initialState?: { ads?: { list?: NextDataAd[] } };
        };
      };
    };
    const ads: NextDataAd[] =
      root?.props?.pageProps?.ads ??
      root?.props?.pageProps?.initialState?.ads?.list ??
      [];

    return ads
      .slice(0, this.options.maxListings)
      .map((ad) => this.toListing(ad))
      .filter((listing): listing is RentalListing => listing !== null);
  }

  private fromAdCards($: CheerioAPI): RentalListing[] {
    const results: RentalListing[] = [];

    $("section.olx-adcard").each((_, element) => {
      if (results.length >= this.options.maxListings) return false;

      const card = $(element);
      const title = card.find(".olx-adcard__title").first().text().trim();
      const rent = this.parseMoney(
        card.find(".olx-adcard__price").first().text(),
      );
      if (!title || rent === null) return;

      const href =
        card.find("a[data-testid='adcard-link']").first().attr("href") ?? "";
      const priceInfo = this.readPriceInfo(
        card
          .find("[data-testid='adcard-price-info']")
          .map((_i, el) => $(el).text())
          .get(),
      );
      const details = card
        .find(".olx-adcard__detail[aria-label]")
        .map((_i, el) => $(el).attr("aria-label") ?? "")
        .get();
      const location = card.find(".olx-adcard__location").first().text().trim();
      const [cidade, bairro] = this.splitLocation(location);

      const attributes: RentalAttributes = {
        ...EMPTY_RENTAL_ATTRIBUTES,
        tipo: this.inferType(title, undefined),
        ...this.readDetails(details),
        condominioBRL: priceInfo.condominio,
        iptuMensalBRL: priceInfo.iptu,
        bairro,
        cidade,
      };

      results.push({
        listingId: this.resolveListingId(href, card.html() ?? "", title),
        source: "olx",
        title,
        rentBRL: rent,
        monthlyTotalBRL: computeMonthlyTotal(rent, attributes),
        currency: "BRL",
        url: this.resolveUrl(href),
        location: location || "N/A",
        publishedAt:
          card.find(".olx-adcard__date").first().text().trim() || undefined,
        attributes,
      });
    });

    return results;
  }

  /** aria-labels such as "63 metros quadrados", "2 quartos", "1 vaga de garagem". */
  private readDetails(labels: string[]): Partial<RentalAttributes> {
    const attributes: Partial<RentalAttributes> = {};

    for (const label of labels) {
      const normalized = this.normalizeKey(label);
      const value = Number.parseInt(normalized, 10);
      if (!Number.isFinite(value)) continue;

      if (normalized.includes("metros quadrados") || normalized.includes("m2")) {
        attributes.areaM2 = value > 0 ? value : null;
      } else if (normalized.includes("quarto")) {
        attributes.quartos = value;
      } else if (normalized.includes("suite")) {
        attributes.suites = value;
      } else if (normalized.includes("banheiro")) {
        attributes.banheiros = value;
      } else if (normalized.includes("vaga") || normalized.includes("garagem")) {
        attributes.vagas = value;
      }
    }

    return attributes;
  }

  /** "IPTU R$ 450" / "Condomínio R$ 1.400" rendered next to the rent. */
  private readPriceInfo(labels: string[]): {
    condominio: number | null;
    iptu: number | null;
  } {
    let condominio: number | null = null;
    let iptu: number | null = null;

    for (const label of labels) {
      const normalized = this.normalizeKey(label);
      const value = this.parseMoney(label);
      if (value === null) continue;
      if (normalized.startsWith("condominio")) condominio = value;
      else if (normalized.startsWith("iptu")) iptu = value;
    }

    return { condominio, iptu };
  }

  /** OLX renders the location as "Cidade, Bairro". */
  private splitLocation(location: string): [string | null, string | null] {
    const parts = location
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) return [null, null];
    if (parts.length === 1) return [parts[0], null];
    return [parts[0], parts[1]];
  }

  private resolveListingId(
    href: string,
    cardHtml: string,
    title: string,
  ): string {
    const fromHref = href.match(/-(\d{6,})(?:\?|$)/);
    if (fromHref) return fromHref[1];

    const fromImage = cardHtml.match(
      /img\.olx\.com\.br\/thumbs\d+x\d+\/\d+\/(\d+)/,
    );
    if (fromImage) return `olx-img-${fromImage[1]}`;

    return `olx-title-${Buffer.from(title).toString("base64url").slice(-16)}`;
  }

  private resolveUrl(href: string): string {
    if (href.startsWith("http")) return href;
    if (href && href !== "#") return `${OlxRentalScraper.BASE_URL}${href}`;
    return `${OlxRentalScraper.BASE_URL}/${OlxRentalScraper.RENTAL_PATH}/${this.options.region}`;
  }

  private toListing(ad: NextDataAd): RentalListing | null {
    const url = ad.url ?? "";
    const rent = this.normalizeRent(ad.priceValue, ad.price);
    if (!url || rent === null) return null;

    const title = (ad.subject ?? ad.title ?? "Sem título").trim();
    const props = this.indexProperties(ad.properties ?? []);
    const attributes = this.toAttributes(ad, title, props);

    return {
      listingId: String(ad.listId ?? this.extractListingId(url)),
      source: "olx",
      title,
      rentBRL: rent,
      monthlyTotalBRL: computeMonthlyTotal(rent, attributes),
      currency: "BRL",
      url,
      location:
        [ad.location?.neighbourhood, ad.location?.municipality, ad.location?.uf]
          .filter(Boolean)
          .join(" - ") || "N/A",
      publishedAt: ad.publishedAt ?? ad.date,
      category: ad.category?.name,
      attributes,
    };
  }

  private toAttributes(
    ad: NextDataAd,
    title: string,
    props: Map<string, string>,
  ): RentalAttributes {
    return {
      tipo: this.inferType(title, this.readField(props, "tipo")),
      areaM2: this.readNumber(props, "areaM2") ?? this.areaFromTitle(title),
      quartos: this.readInt(props, "quartos") ?? this.roomsFromTitle(title),
      suites: this.readInt(props, "suites"),
      banheiros: this.readInt(props, "banheiros"),
      vagas: this.readInt(props, "vagas"),
      condominioBRL: this.readNumber(props, "condominioBRL"),
      iptuMensalBRL: this.readNumber(props, "iptuMensalBRL"),
      bairro: ad.location?.neighbourhood?.trim() || null,
      cidade: ad.location?.municipality?.trim() || null,
      uf: ad.location?.uf?.trim() || null,
      andar: this.readInt(props, "andar"),
      mobiliado: this.readBoolean(props, "mobiliado"),
      aceitaPet: this.readBoolean(props, "aceitaPet"),
    };
  }

  private indexProperties(properties: NextDataProperty[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const property of properties) {
      const value = property.value;
      if (value === undefined || value === null || `${value}`.trim() === "") {
        continue;
      }
      for (const key of [property.name, property.label]) {
        if (!key) continue;
        map.set(this.normalizeKey(key), `${value}`.trim());
      }
    }
    return map;
  }

  private readField(props: Map<string, string>, field: string): string | undefined {
    for (const alias of OlxRentalScraper.FIELD_ALIASES[field] ?? []) {
      const hit = props.get(this.normalizeKey(alias));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  private readNumber(props: Map<string, string>, field: string): number | null {
    const raw = this.readField(props, field);
    if (raw === undefined) return null;
    const parsed = this.parseMoney(raw);
    return parsed !== null && parsed > 0 ? parsed : null;
  }

  private readInt(props: Map<string, string>, field: string): number | null {
    const value = this.readNumber(props, field);
    return value === null ? null : Math.round(value);
  }

  private readBoolean(
    props: Map<string, string>,
    field: string,
  ): boolean | null {
    const raw = this.readField(props, field);
    if (raw === undefined) return null;
    const normalized = this.normalizeKey(raw);
    if (["sim", "true", "1", "aceita", "mobiliado"].includes(normalized)) {
      return true;
    }
    if (["nao", "false", "0", "nao aceita"].includes(normalized)) return false;
    return null;
  }

  private inferType(
    title: string,
    hint: string | undefined,
  ): RentalPropertyType {
    const haystack = this.normalizeKey(`${hint ?? ""} ${title}`);
    for (const [pattern, type] of OlxRentalScraper.TYPE_KEYWORDS) {
      if (pattern.test(haystack)) return type;
    }
    return "outro";
  }

  private areaFromTitle(title: string): number | null {
    const match = title.match(/(\d{2,4})\s?(?:m²|m2|metros)/i);
    if (!match) return null;
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private roomsFromTitle(title: string): number | null {
    const match = title.match(
      /(\d)\s?(?:quartos?|dorms?|dormitórios?|dormitorios?|qtos?)/i,
    );
    if (!match) return null;
    const value = Number.parseInt(match[1], 10);
    return Number.isFinite(value) ? value : null;
  }

  private normalizeRent(
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
    return this.parseMoney(priceLabel);
  }

  private extractListingId(url: string): string {
    const match = url.match(/-(\d+)(?:\?|$)/);
    if (match) return match[1];
    return Buffer.from(url).toString("base64url").slice(-16);
  }

  /** Handles "R$ 2.500", "2.500,00", "85 m²" and bare numbers alike. */
  private parseMoney(label: string | undefined): number | null {
    if (!label) return null;
    const cleaned = label.replace(/[^\d.,]/g, "");
    if (!cleaned) return null;
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/\.(?=\d{3}\b)/g, "");
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private normalizeKey(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
