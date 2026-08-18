import { z } from "zod";

export const PriceHistoryEntrySchema = z.object({
  timestamp: z.string(),
  query: z.string(),
  listingId: z.string(),
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  location: z.string(),
  url: z.string(),
  previousPrice: z.number().nullable(),
  priceChange: z.number().nullable(),
  changePercent: z.number().nullable(),
  observationCount: z.number().int().nonnegative(),
  rating: z.string().nullable(),
  estimatedFairTotal: z.number().nullable(),
  deltaPercent: z.number().nullable(),
  componentsBreakdown: z.string().nullable(),
  missingComponents: z.string().nullable(),
  ratingReasoning: z.string().nullable(),
});

export type PriceHistoryEntry = z.infer<typeof PriceHistoryEntrySchema>;
