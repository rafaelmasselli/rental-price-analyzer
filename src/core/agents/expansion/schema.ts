import { z } from "zod";

export const expansionSchema = z.object({
  queries: z
    .array(z.string().min(2))
    .min(1)
    .max(8)
    .describe(
      "Semantically related search query variations. Include the original query as the first item.",
    ),
});

export type ExpansionSchemaOutput = z.infer<typeof expansionSchema>;
