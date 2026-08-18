import type { Listing } from "../../shared/models/index.js";

export interface IListingSource {
  search(query: string): Promise<Listing[]>;
  searchMany(queries: string[]): Promise<Listing[]>;
}
