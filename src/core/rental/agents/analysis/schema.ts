import { z } from "zod";

const rankedRentalSchema = z.object({
  listingId: z.string().describe("listing identifier of the ranked entry"),
  score: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "Overall score from 0 (avoid) to 10 (best rental), weighing total monthly cost against the neighbourhood benchmark, condition of the ad and risk signals",
    ),
  reasoning: z
    .string()
    .describe("Short sentence in Portuguese explaining why this ranks here"),
});

export const rentalAnalysisSchema = z.object({
  topPicks: z
    .array(rankedRentalSchema)
    .max(5)
    .describe("Top 5 rentals ranked from best to worst overall value"),
  cheapestListingId: z
    .string()
    .describe("listingId with the lowest TOTAL monthly cost among credible ads"),
  significantDropListingIds: z
    .array(z.string())
    .describe("listingIds whose monthly cost dropped (change_percent <= -3)"),
  recommendation: z
    .string()
    .describe(
      "2-4 sentences in Portuguese: which unit to visit first, what to negotiate, and what to double-check before signing",
    ),
});

export type RentalAnalysisOutput = z.infer<typeof rentalAnalysisSchema>;
