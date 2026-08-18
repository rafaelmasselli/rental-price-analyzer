import { z } from "zod";

const rankedListingSchema = z.object({
  listingId: z.string().describe("listing identifier"),
  score: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Overall value score 0-10, considering price vs fair total, completeness, recency, and rating history",
    ),
  reasoning: z
    .string()
    .describe("One sentence justifying the ranking with concrete numbers"),
});

export const historicalAnalysisSchema = z.object({
  topPicks: z
    .array(rankedListingSchema)
    .max(10)
    .describe("Top historical deals from the batch, ranked best to worst"),
  marketPatterns: z
    .string()
    .describe(
      "2-3 sentence observation about price ranges, distribution, and overall market behavior in this set",
    ),
  componentObservations: z
    .string()
    .describe(
      "2-3 sentence observation about which components consistently appear cheap vs expensive, and what to watch for",
    ),
  buyOrWait: z
    .string()
    .describe(
      "Concrete advice in 2-3 sentences: buy now, wait, or specific conditions to act on (in Portuguese)",
    ),
});

export type HistoricalAnalysisOutput = z.infer<typeof historicalAnalysisSchema>;
