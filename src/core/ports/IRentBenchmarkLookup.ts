import type { RentBenchmark } from "../../shared/models/index.js";

export interface BenchmarkKey {
  cidade: string | null;
  bairro: string | null;
  quartos: number | null;
  tipo: string;
  /** R$/m2 falls as units get larger, so comparables are size-banded. */
  areaM2: number | null;
}

/** One observation feeding the comparables pool. */
export interface CompRecord {
  cidade: string | null;
  bairro: string | null;
  quartos: number | null;
  tipo: string;
  areaM2: number | null;
  monthlyTotalBRL: number;
}

/**
 * Replaces the marketplace price lookup used for PC parts: there is no
 * marketplace where you can price "a bedroom", so the fair price of a rental
 * comes from comparables — the median R$/m2 of similar units in the same area.
 */
export interface IRentBenchmarkLookup {
  /** Seeds the pool with the current batch, so a cold database still works. */
  prime(records: CompRecord[]): Promise<void>;
  lookup(key: BenchmarkKey): Promise<RentBenchmark | null>;
}
