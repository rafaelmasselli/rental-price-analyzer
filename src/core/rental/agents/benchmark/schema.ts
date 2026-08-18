import { z } from "zod";

const estimatedRentSchema = z.object({
  listingId: z.string(),
  fairMonthlyTotalBRL: z
    .number()
    .describe(
      "Your best estimate of the fair TOTAL monthly cost (rent + condo + monthly IPTU) for this property in this neighbourhood, in BRL. Commit to a number.",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe("How well you know this neighbourhood's rental market"),
  reasoning: z
    .string()
    .describe("One short sentence in Portuguese justifying the estimate"),
});

export const rentEstimateSchema = z.object({
  estimates: z.array(estimatedRentSchema),
});

export type RentEstimateOutput = z.infer<typeof rentEstimateSchema>;
