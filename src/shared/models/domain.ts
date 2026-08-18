import { z } from "zod";

export const ListingComponentSchema = z.object({
  category: z.enum([
    "cpu",
    "motherboard",
    "ram",
    "storage",
    "gpu",
    "cooler",
    "psu",
    "case",
    "other",
  ]),
  spec: z.string(),
  estimatedPriceBRL: z.number().nullable(),
  priceSource: z.enum(["mercadolivre", "llm_estimate", "none"]),
  marketSampleSize: z.number().int().nonnegative(),
  marketSourceUrl: z.string().nullable(),
});

export const ListingRatingSchema = z.object({
  classification: z.enum(["good_deal", "fair", "overpriced"]),
  components: z.array(ListingComponentSchema),
  estimatedFairTotalBRL: z.number(),
  deltaPercent: z.number(),
  missingStandardComponents: z.array(z.string()),
  reasoning: z.string(),
});

export const ListingSchema = z.object({
  listingId: z.string(),
  title: z.string(),
  price: z.number().positive(),
  currency: z.string().default("BRL"),
  url: z.string().url(),
  location: z.string(),
  publishedAt: z.string().optional(),
  category: z.string().optional(),
  rating: ListingRatingSchema.optional(),
});

export const ListingWithDeltaSchema = ListingSchema.extend({
  previousPrice: z.number().nullable(),
  priceChange: z.number().nullable(),
  changePercent: z.number().nullable(),
  observationCount: z.number().int().nonnegative(),
});

export const TopPickSchema = z.object({
  listing: ListingWithDeltaSchema,
  score: z.number(),
  reasoning: z.string(),
});

export const PriceAnalysisSchema = z.object({
  topPicks: z.array(TopPickSchema),
  cheapestListing: ListingWithDeltaSchema.nullable(),
  averagePrice: z.number(),
  priceRange: z.object({ min: z.number(), max: z.number() }),
  marketVariationPercent: z.number(),
  significantDrops: z.array(ListingWithDeltaSchema),
  recommendation: z.string(),
});

export type ListingComponent = z.infer<typeof ListingComponentSchema>;
export type ListingRating = z.infer<typeof ListingRatingSchema>;
export type Listing = z.infer<typeof ListingSchema>;
export type ListingWithDelta = z.infer<typeof ListingWithDeltaSchema>;
export type TopPick = z.infer<typeof TopPickSchema>;
export type PriceAnalysis = z.infer<typeof PriceAnalysisSchema>;
