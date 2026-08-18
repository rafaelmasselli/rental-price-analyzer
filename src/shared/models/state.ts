import { z } from "zod";
import {
  ListingSchema,
  ListingWithDeltaSchema,
  PriceAnalysisSchema,
} from "./domain.js";

export const SimilarMatchSchema = z.object({
  listingId: z.string(),
  title: z.string(),
  url: z.string(),
  query: z.string(),
  similarity: z.number(),
  lastPrice: z.number(),
  lastSeenAt: z.string(),
  rating: z.string().nullable(),
});

export const GraphStateSchema = z.object({
  query: z.string(),
  expandedQueries: z.array(z.string()),
  rawListings: z.array(ListingSchema),
  listingsWithHistory: z.array(ListingWithDeltaSchema),
  analysis: PriceAnalysisSchema.nullable(),
  csvPath: z.string(),
  similarListings: z.array(SimilarMatchSchema),
});

export type SimilarMatchState = z.infer<typeof SimilarMatchSchema>;
export type GraphState = z.infer<typeof GraphStateSchema>;
