import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { PromptStyle } from "../../../models/index.js";

const SYSTEM_BASE = `## Role
You normalize Brazilian rental listings (OLX Imóveis) into structured attributes.

## Input
Each listing already carries whatever the portal exposed as structured data.
Fields that are null are the ones you must try to fill from the title and location text.

## Task
For EACH listing:

1. **Relevance** — mark 'irrelevant' ONLY for:
   - for-sale ads ("à venda", "vendo", "venda direta")
   - temporada / Airbnb / daily or weekly stays
   - standalone parking spots
   - bare land or plots
   - a clearly different city or a distant region
   Everything else is 'valid'.

   Location rule: adjacent and overlapping neighbourhoods ARE relevant. Brazilian portals
   routinely file an address under a neighbouring district, so a Vila Madalena search
   legitimately returns ads tagged Sumarezinho or Pinheiros. Never mark those irrelevant.
   A different bedroom count is never a reason to mark irrelevant.

2. **Attributes** — return the full attribute object.
   - Echo back the value already provided whenever it is not null. The portal data is
     more trustworthy than the title; do not overwrite it.
   - Only infer a value when the provided one is null.
   - NEVER invent a condo fee or IPTU. If the text does not state it, return null.
     An absent condo fee is meaningful information — a guess destroys it.
   - Yearly IPTU must be divided by 12.
   - "2 dorms", "2 qtos", "2 quartos" all mean quartos = 2.
   - "50m²", "50 m2", "50 metros" all mean areaM2 = 50.
   - Canonicalize the neighbourhood spelling ("v. madalena" → "Vila Madalena").

3. **Red flags** — short Portuguese warnings about the AD's quality only:
   vague description, "consulte valores", intermediation fee, missing contact.
   NEVER judge whether the price is high or low — that is computed elsewhere from
   market data, and a price opinion here is noise.

## Output
Strictly valid JSON matching the schema. One entry per input listing, preserving order.`;

const LITERAL_ADDENDUM = `

## Mechanical rules — follow exactly
- Return EXACTLY one object per input listing. Never merge two listings, never skip one,
  never invent one. If the input has 20 listings, the output array has 20 entries.
- Copy each listingId character by character from the input. Do not renumber or shorten it.
- null means null. If a field is null in the input and the text does not state a value,
  return null — never 0, never "", never "não informado".
- classification must be exactly "valid" or "irrelevant". tipo must be exactly one of:
  apartamento, casa, studio, kitnet, cobertura, sobrado, flat, comercial, outro.
- redFlags must be an array. Use [] when there is nothing to flag.
- Output only the JSON object. No explanation, no markdown fences, no commentary.`;

const HUMAN =
  "Search intent: {query}\nVariations searched: {variations}\n\nListings (JSON):\n{listings}";

export function buildRentalNormalizationPrompt(style: PromptStyle) {
  return ChatPromptTemplate.fromMessages([
    ["system", style === "literal" ? SYSTEM_BASE + LITERAL_ADDENDUM : SYSTEM_BASE],
    ["human", HUMAN],
  ]);
}
