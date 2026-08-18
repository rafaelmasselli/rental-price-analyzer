import type {
  BenchmarkKey,
  CompRecord,
  IRentBenchmarkLookup,
} from "../../core/ports/index.js";
import type {
  RentBenchmark,
  RentBenchmarkScope,
} from "../../shared/models/index.js";

export interface NeighborhoodBenchmarkOptions {
  /** Minimum comparables required before a median is trusted. */
  minSampleSize?: number;
}

interface ScopeDefinition {
  scope: RentBenchmarkScope;
  label: (key: BenchmarkKey) => string;
  matches: (comp: CompRecord, key: BenchmarkKey) => boolean;
  requires: (key: BenchmarkKey) => boolean;
}

/**
 * Fair-rent estimator based on comparables. Walks from the narrowest scope
 * (same neighbourhood, same bedroom count, same property type) outward until it
 * finds enough observations, and reports which scope answered so the caller can
 * tell a solid median from a desperate one.
 */
export class NeighborhoodBenchmark implements IRentBenchmarkLookup {
  private static readonly DEFAULT_MIN_SAMPLE = 5;

  /** Guards the median against parsing garbage (R$/m2 per month). */
  private static readonly MIN_PER_M2 = 3;
  private static readonly MAX_PER_M2 = 400;

  /**
   * Half-width of the size band, as a fraction of the target area. R$/m2 is not
   * flat across sizes — a 100m2 unit rents for noticeably less per square metre
   * than a 40m2 one in the same building. Comparing a large flat against the
   * whole neighbourhood makes it look like a steal, and a small one like a
   * rip-off, so the narrow scopes only compare units of a similar size.
   */
  static readonly AREA_BAND = 0.25;

  private static readonly SCOPES: ScopeDefinition[] = [
    {
      scope: "bairro_quartos_tipo_area",
      label: (key) =>
        `${key.bairro} · ${key.quartos} quarto(s) · ${key.tipo} · ~${key.areaM2}m²`,
      requires: (key) =>
        key.bairro !== null && key.quartos !== null && key.areaM2 !== null,
      matches: (comp, key) =>
        sameText(comp.cidade, key.cidade) &&
        sameText(comp.bairro, key.bairro) &&
        comp.quartos === key.quartos &&
        comp.tipo === key.tipo &&
        sameSizeBand(comp.areaM2, key.areaM2),
    },
    {
      scope: "bairro_quartos_area",
      label: (key) => `${key.bairro} · ${key.quartos} quarto(s) · ~${key.areaM2}m²`,
      requires: (key) =>
        key.bairro !== null && key.quartos !== null && key.areaM2 !== null,
      matches: (comp, key) =>
        sameText(comp.cidade, key.cidade) &&
        sameText(comp.bairro, key.bairro) &&
        comp.quartos === key.quartos &&
        sameSizeBand(comp.areaM2, key.areaM2),
    },
    {
      scope: "bairro_quartos_tipo",
      label: (key) =>
        `${key.bairro} · ${key.quartos} quarto(s) · ${key.tipo}`,
      requires: (key) =>
        key.bairro !== null && key.quartos !== null,
      matches: (comp, key) =>
        sameText(comp.cidade, key.cidade) &&
        sameText(comp.bairro, key.bairro) &&
        comp.quartos === key.quartos &&
        comp.tipo === key.tipo,
    },
    {
      scope: "bairro_quartos",
      label: (key) => `${key.bairro} · ${key.quartos} quarto(s)`,
      requires: (key) => key.bairro !== null && key.quartos !== null,
      matches: (comp, key) =>
        sameText(comp.cidade, key.cidade) &&
        sameText(comp.bairro, key.bairro) &&
        comp.quartos === key.quartos,
    },
    {
      scope: "bairro",
      label: (key) => `${key.bairro} (todas as tipologias)`,
      requires: (key) => key.bairro !== null,
      matches: (comp, key) =>
        sameText(comp.cidade, key.cidade) && sameText(comp.bairro, key.bairro),
    },
    {
      scope: "cidade_quartos",
      label: (key) => `${key.cidade} · ${key.quartos} quarto(s)`,
      requires: (key) => key.cidade !== null && key.quartos !== null,
      matches: (comp, key) =>
        sameText(comp.cidade, key.cidade) && comp.quartos === key.quartos,
    },
    {
      scope: "cidade",
      label: (key) => `${key.cidade} (todas as tipologias)`,
      requires: (key) => key.cidade !== null,
      matches: (comp, key) => sameText(comp.cidade, key.cidade),
    },
  ];

  private readonly minSampleSize: number;
  private comps: CompRecord[] = [];

  constructor(options: NeighborhoodBenchmarkOptions = {}) {
    this.minSampleSize =
      options.minSampleSize ?? NeighborhoodBenchmark.DEFAULT_MIN_SAMPLE;
  }

  async prime(records: CompRecord[]): Promise<void> {
    this.comps = this.comps.concat(records);
  }

  get poolSize(): number {
    return this.comps.length;
  }

  async lookup(key: BenchmarkKey): Promise<RentBenchmark | null> {
    for (const definition of NeighborhoodBenchmark.SCOPES) {
      if (!definition.requires(key)) continue;

      const pool = this.comps.filter((comp) => definition.matches(comp, key));
      if (pool.length < this.minSampleSize) continue;

      const perM2Samples = pool
        .filter((comp) => comp.areaM2 !== null && comp.areaM2 > 0)
        .map((comp) => comp.monthlyTotalBRL / (comp.areaM2 as number))
        .filter(
          (value) =>
            value >= NeighborhoodBenchmark.MIN_PER_M2 &&
            value <= NeighborhoodBenchmark.MAX_PER_M2,
        );

      return {
        scope: definition.scope,
        label: definition.label(key),
        medianPricePerM2:
          perM2Samples.length >= this.minSampleSize
            ? round2(median(perM2Samples))
            : null,
        medianMonthlyTotal: Math.round(
          median(pool.map((comp) => comp.monthlyTotalBRL)),
        ),
        sampleSize: pool.length,
      };
    }

    return null;
  }
}

function sameSizeBand(
  compArea: number | null,
  targetArea: number | null,
): boolean {
  if (compArea === null || targetArea === null || targetArea <= 0) return false;
  return (
    Math.abs(compArea - targetArea) / targetArea <=
    NeighborhoodBenchmark.AREA_BAND
  );
}

function sameText(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return normalize(a) === normalize(b);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
