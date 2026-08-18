import { z } from "zod";

const rankedListingSchema = z.object({
  listingId: z.string().describe("listing identifier of the ranked entry"),
  score: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Overall score from 0 (avoid) to 10 (best deal), considering price, completeness, credibility and location",
    ),
  reasoning: z
    .string()
    .describe("Short sentence explaining why this ranks here"),
});

export const analysisSchema = z.object({
  topPicks: z
    .array(rankedListingSchema)
    .max(5)
    .describe("Top 5 best deals ranked from best to worst overall value"),
  cheapestListingId: z
    .string()
    .describe("The listingId of the cheapest valid listing"),
  averagePrice: z.number().describe("Average price across all listings"),
  minPrice: z.number().describe("Lowest price"),
  maxPrice: z.number().describe("Highest price"),
  marketVariationPercent: z
    .number()
    .describe("Percentage variation between maxPrice and minPrice"),
  significantDropListingIds: z
    .array(z.string())
    .describe(
      "listingIds with change_percent <= -3 and observation_count > 1",
    ),
  recommendation: z
    .string()
    .describe(
      "2-3 sentence summary advising which listing to buy and why, in Portuguese",
    ),
});

export type AnalysisSchemaOutput = z.infer<typeof analysisSchema>;
