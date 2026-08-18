import { z } from "zod";

const normalizedAttributesSchema = z.object({
  tipo: z
    .enum([
      "apartamento",
      "casa",
      "studio",
      "kitnet",
      "cobertura",
      "sobrado",
      "flat",
      "comercial",
      "outro",
    ])
    .describe("Property type inferred from the title/description"),
  areaM2: z
    .number()
    .nullable()
    .describe("Usable area in square metres. null if not stated anywhere."),
  quartos: z.number().nullable().describe("Bedroom count. null if unknown."),
  suites: z.number().nullable().describe("En-suite count. null if unknown."),
  banheiros: z.number().nullable().describe("Bathroom count. null if unknown."),
  vagas: z.number().nullable().describe("Parking spots. null if unknown."),
  condominioBRL: z
    .number()
    .nullable()
    .describe(
      "Monthly condo fee in BRL if stated in the text. null if not stated — never guess.",
    ),
  iptuMensalBRL: z
    .number()
    .nullable()
    .describe(
      "Monthly IPTU in BRL. If the text states a yearly amount, divide by 12. null if not stated.",
    ),
  bairro: z
    .string()
    .nullable()
    .describe("Neighbourhood name, canonical spelling. null if unknown."),
  cidade: z.string().nullable().describe("City name. null if unknown."),
  mobiliado: z
    .boolean()
    .nullable()
    .describe("true if furnished, false if explicitly unfurnished, null if unstated"),
  aceitaPet: z
    .boolean()
    .nullable()
    .describe("true/false only when the text says so, otherwise null"),
});

const normalizedListingSchema = z.object({
  listingId: z.string(),
  classification: z
    .enum(["valid", "irrelevant"])
    .describe(
      "valid: a long-term rental matching the search intent; irrelevant: for sale, short-stay/temporada, parking spot only, land, or a different property type/location than requested",
    ),
  attributes: normalizedAttributesSchema,
  redFlags: z
    .array(z.string())
    .describe(
      "Short warnings in Portuguese about the listing itself (vague description, price that looks like a typo, agency fee mentioned, 'consulte valores'). Empty when nothing stands out.",
    ),
});

export const rentalNormalizationSchema = z.object({
  listings: z.array(normalizedListingSchema),
});

export type RentalNormalizationOutput = z.infer<
  typeof rentalNormalizationSchema
>;
