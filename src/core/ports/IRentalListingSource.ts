import type { RentalListing } from "../../shared/models/index.js";

export interface RentalSearchFilters {
  cidade?: string;
  bairro?: string;
  minQuartos?: number;
  maxMonthlyTotal?: number;
}

export interface IRentalListingSource {
  search(query: string): Promise<RentalListing[]>;
  searchMany(queries: string[]): Promise<RentalListing[]>;
}
