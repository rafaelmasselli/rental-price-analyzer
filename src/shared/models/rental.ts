import { z } from "zod";

export const RentalSourceSchema = z.enum([
  "olx",
  "zap",
  "vivareal",
  "quintoandar",
]);

export const RentalPropertyTypeSchema = z.enum([
  "apartamento",
  "casa",
  "studio",
  "kitnet",
  "cobertura",
  "sobrado",
  "flat",
  "comercial",
  "outro",
]);

export const RentalAttributesSchema = z.object({
  tipo: RentalPropertyTypeSchema,
  areaM2: z.number().positive().nullable(),
  quartos: z.number().int().nonnegative().nullable(),
  suites: z.number().int().nonnegative().nullable(),
  banheiros: z.number().int().nonnegative().nullable(),
  vagas: z.number().int().nonnegative().nullable(),
  condominioBRL: z.number().nonnegative().nullable(),
  iptuMensalBRL: z.number().nonnegative().nullable(),
  bairro: z.string().nullable(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  andar: z.number().int().nullable(),
  mobiliado: z.boolean().nullable(),
  aceitaPet: z.boolean().nullable(),
});

export const RentBenchmarkScopeSchema = z.enum([
  "bairro_quartos_tipo_area",
  "bairro_quartos_area",
  "bairro_quartos_tipo",
  "bairro_quartos",
  "bairro",
  "cidade_quartos",
  "cidade",
  "llm_estimate",
  "none",
]);

export const RentBenchmarkSchema = z.object({
  scope: RentBenchmarkScopeSchema,
  label: z.string(),
  medianPricePerM2: z.number().nullable(),
  medianMonthlyTotal: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
});

export const RentalRatingSchema = z.object({
  classification: z.enum(["good_deal", "fair", "overpriced"]),
  /** Barato a ponto de indicar informação faltando, não oportunidade. */
  suspicious: z.boolean(),
  fairMonthlyTotalBRL: z.number(),
  deltaPercent: z.number(),
  pricePerM2: z.number().nullable(),
  benchmark: RentBenchmarkSchema,
  warnings: z.array(z.string()),
  reasoning: z.string(),
});

export const RentalListingSchema = z.object({
  listingId: z.string(),
  source: RentalSourceSchema,
  title: z.string(),
  rentBRL: z.number().positive(),
  monthlyTotalBRL: z.number().positive(),
  currency: z.string().default("BRL"),
  url: z.string().url(),
  location: z.string(),
  publishedAt: z.string().optional(),
  category: z.string().optional(),
  attributes: RentalAttributesSchema,
  rating: RentalRatingSchema.optional(),
});

export const RentalListingWithDeltaSchema = RentalListingSchema.extend({
  previousMonthlyTotal: z.number().nullable(),
  monthlyChange: z.number().nullable(),
  changePercent: z.number().nullable(),
  observationCount: z.number().int().nonnegative(),
});

export const RentalTopPickSchema = z.object({
  listing: RentalListingWithDeltaSchema,
  score: z.number(),
  reasoning: z.string(),
});

export const RentalAnalysisSchema = z.object({
  topPicks: z.array(RentalTopPickSchema),
  cheapestListing: RentalListingWithDeltaSchema.nullable(),
  averageMonthlyTotal: z.number(),
  monthlyTotalRange: z.object({ min: z.number(), max: z.number() }),
  medianPricePerM2: z.number().nullable(),
  marketVariationPercent: z.number(),
  significantDrops: z.array(RentalListingWithDeltaSchema),
  recommendation: z.string(),
});

export const RentalSimilarMatchSchema = z.object({
  listingId: z.string(),
  title: z.string(),
  url: z.string(),
  query: z.string(),
  similarity: z.number(),
  lastMonthlyTotal: z.number(),
  lastSeenAt: z.string(),
  rating: z.string().nullable(),
});

export const RentalGraphStateSchema = z.object({
  query: z.string(),
  expandedQueries: z.array(z.string()),
  rawListings: z.array(RentalListingSchema),
  listingsWithHistory: z.array(RentalListingWithDeltaSchema),
  analysis: RentalAnalysisSchema.nullable(),
  dbPath: z.string(),
  similarListings: z.array(RentalSimilarMatchSchema),
});

export type RentalSource = z.infer<typeof RentalSourceSchema>;
export type RentalPropertyType = z.infer<typeof RentalPropertyTypeSchema>;
export type RentalAttributes = z.infer<typeof RentalAttributesSchema>;
export type RentalListing = z.infer<typeof RentalListingSchema>;
export type RentBenchmarkScope = z.infer<typeof RentBenchmarkScopeSchema>;
export type RentBenchmark = z.infer<typeof RentBenchmarkSchema>;
export type RentalRating = z.infer<typeof RentalRatingSchema>;
export type RentalListingWithDelta = z.infer<
  typeof RentalListingWithDeltaSchema
>;
export type RentalTopPick = z.infer<typeof RentalTopPickSchema>;
export type RentalAnalysis = z.infer<typeof RentalAnalysisSchema>;
export type RentalSimilarMatch = z.infer<typeof RentalSimilarMatchSchema>;
export type RentalGraphState = z.infer<typeof RentalGraphStateSchema>;

export const EMPTY_RENTAL_ATTRIBUTES: RentalAttributes = {
  tipo: "outro",
  areaM2: null,
  quartos: null,
  suites: null,
  banheiros: null,
  vagas: null,
  condominioBRL: null,
  iptuMensalBRL: null,
  bairro: null,
  cidade: null,
  uf: null,
  andar: null,
  mobiliado: null,
  aceitaPet: null,
};

/** Rent + condo fee + monthly IPTU. The only number worth comparing. */
export function computeMonthlyTotal(
  rentBRL: number,
  attributes: RentalAttributes,
): number {
  const condo = attributes.condominioBRL ?? 0;
  const iptu = attributes.iptuMensalBRL ?? 0;
  return Math.round(rentBRL + condo + iptu);
}

/** Recomputes `monthlyTotalBRL` after any change to rent or attributes. */
export function withMonthlyTotal<T extends RentalListing>(listing: T): T {
  return {
    ...listing,
    monthlyTotalBRL: computeMonthlyTotal(listing.rentBRL, listing.attributes),
  };
}

export function pricePerM2(listing: RentalListing): number | null {
  const area = listing.attributes.areaM2;
  if (!area || area <= 0) return null;
  return listing.monthlyTotalBRL / area;
}
