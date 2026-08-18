import { z } from "zod";

const extractedComponentSchema = z.object({
  category: z
    .enum([
      "cpu",
      "motherboard",
      "ram",
      "storage",
      "gpu",
      "cooler",
      "psu",
      "case",
      "other",
    ])
    .describe("Type of PC component detected"),
  spec: z
    .string()
    .describe(
      "Canonical, search-engine-friendly query for this exact part. Examples: 'Ryzen 5 7600X', 'B650M Aorus Elite', '32GB DDR5 6000MHz'.",
    ),
  approximatePriceBRL: z
    .number()
    .describe(
      "Your best estimate of this component's used-market price in BRL on the Brazilian market (OLX/Mercado Livre). Commit to a number — this is the fallback when external lookup fails.",
    ),
});

const ratedListingSchema = z.object({
  listingId: z.string(),
  classification: z
    .enum(["valid", "irrelevant"])
    .describe(
      "valid: this is genuinely a kit matching the user intent; irrelevant: different product/platform/category",
    ),
  components: z
    .array(extractedComponentSchema)
    .describe(
      "Every distinct PC component detected. Empty array only if irrelevant.",
    ),
  missingStandardComponents: z
    .array(z.string())
    .describe(
      "Standard parts that an upgrade kit usually has but are absent (e.g., 'RAM', 'cooler'). Empty if nothing missing.",
    ),
  intent: z
    .string()
    .describe(
      "One short sentence describing what is being sold",
    ),
});

export const ratingSchema = z.object({
  ratings: z.array(ratedListingSchema),
});

export type RatingSchemaOutput = z.infer<typeof ratingSchema>;
