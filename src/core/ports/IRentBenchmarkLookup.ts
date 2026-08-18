import type { RentBenchmark } from "../../shared/models/index.js";

export interface BenchmarkKey {
  cidade: string | null;
  bairro: string | null;
  quartos: number | null;
  tipo: string;
  /** Comparáveis são limitados a uma faixa de área parecida. */
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

export interface IRentBenchmarkLookup {
  /** Seeds the pool with the current batch, so a cold database still works. */
  prime(records: CompRecord[]): Promise<void>;
  lookup(key: BenchmarkKey): Promise<RentBenchmark | null>;
}
