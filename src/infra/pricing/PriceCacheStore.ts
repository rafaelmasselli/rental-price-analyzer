import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ComponentPriceQuote } from "../../core/ports/index.js";

interface CacheEntry {
  quote: ComponentPriceQuote | null;
  fetchedAt: number;
}

export class PriceCacheStore {
  private static readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  private readonly cacheRoot: string;
  private readonly ttlMs: number;
  private readonly entries: Map<string, CacheEntry> = new Map();
  private loaded = false;

  constructor(
    cacheRoot: string = "data/cache/components",
    ttlMs: number = PriceCacheStore.DEFAULT_TTL_MS,
    cwd: string = process.cwd(),
  ) {
    this.cacheRoot = resolve(cwd, cacheRoot);
    this.ttlMs = ttlMs;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    if (!existsSync(this.cacheRoot)) return;

    const categoryDirs = await readdir(this.cacheRoot, { withFileTypes: true });
    const now = Date.now();

    for (const dirent of categoryDirs) {
      if (!dirent.isDirectory()) continue;
      const categoryPath = join(this.cacheRoot, dirent.name);
      const files = await readdir(categoryPath);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(categoryPath, file), "utf-8");
          const entry = JSON.parse(raw) as CacheEntry;
          if (now - entry.fetchedAt > this.ttlMs) continue;
          this.entries.set(this.key(dirent.name, file.replace(/\.json$/, "")), entry);
        } catch {
          // skip malformed file
        }
      }
    }
  }

  get(
    category: string,
    spec: string,
  ): ComponentPriceQuote | null | undefined {
    const cacheKey = this.key(category, this.slugify(spec));
    const entry = this.entries.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.entries.delete(cacheKey);
      return undefined;
    }
    return entry.quote;
  }

  async set(
    category: string,
    spec: string,
    quote: ComponentPriceQuote | null,
  ): Promise<void> {
    const slug = this.slugify(spec);
    const cacheKey = this.key(category, slug);
    const entry: CacheEntry = { quote, fetchedAt: Date.now() };
    this.entries.set(cacheKey, entry);

    const categoryDir = join(this.cacheRoot, category);
    await mkdir(categoryDir, { recursive: true });
    await writeFile(
      join(categoryDir, `${slug}.json`),
      JSON.stringify(entry, null, 2),
      "utf-8",
    );
  }

  size(): number {
    return this.entries.size;
  }

  private key(category: string, slug: string): string {
    return `${category}::${slug}`;
  }

  private slugify(spec: string): string {
    return spec
      .toLowerCase()
      .replace(/[\/\\:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
}
