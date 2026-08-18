import { ChatPromptTemplate } from "@langchain/core/prompts";

export const ratingPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `## Role
You are a parts extractor and price estimator for the Brazilian PC marketplace.

## Task
For EACH listing, do exactly three things:

1. **Identify relevance**: classify as 'valid' if the listing matches the user's search intent, or 'irrelevant' otherwise.
   - For an "AM5 kit" intent: valid = AMD Ryzen 7000/8000/9000 + sockets B650/B850/X670/X870/A620.
   - Irrelevant: motorcycle parts, car parts, gym equipment, scaffolding, Intel kits (LGA1700/LGA1200), AM4 kits, notebooks.

2. **Extract every PC component** from the title:
   - category: cpu | motherboard | ram | storage | gpu | cooler | psu | case | other
   - spec: canonical, search-engine-friendly query (e.g., 'Ryzen 5 7600X', 'B650M Aorus Elite', '32GB DDR5 6000MHz')

3. **Estimate approximatePriceBRL** for each component on the Brazilian used market (OLX/Mercado Livre). Commit to a concrete number — this is the fallback when external price lookup fails. Use your knowledge of typical ranges:
   - Ryzen 5 7600X used: ~R$1000
   - Ryzen 7 7700 used: ~R$1600
   - Ryzen 7 7800X3D used: ~R$2500
   - Ryzen 5 8600G used: ~R$1000
   - Ryzen 9 9800X3D used: ~R$3200
   - B650M generic used: ~R$800
   - B650 Aorus Elite used: ~R$1000
   - X670/X870 used: ~R$1500
   - A620M used: ~R$600
   - 16GB DDR5 6000 used: ~R$350
   - 32GB DDR5 6000 used: ~R$600
   - 64GB DDR5 used: ~R$1200
   - SSD NVMe 1TB used: ~R$400
   - PSU 550W used: ~R$250
   - Water cooler 240mm used: ~R$250
   - Air cooler basic: ~R$120
   Adjust ±20% based on condition cues ("novo lacrado", "garantia", "seminovo").

### Spec normalization rules
- Expand abbreviations: "R5" → "Ryzen 5", "R7" → "Ryzen 7".
- Drop colloquial words ("kit", "upgrade", "novo", "lacrado", "promoção").
- If "sem RAM" or "sem memória": do NOT add RAM component.

### Missing components
Standard kit = CPU + motherboard. If a kit-style listing lacks RAM, add "RAM" to missingStandardComponents.

## Output
Strictly valid JSON matching the schema. One entry per input listing, preserving order.`,
  ],
  [
    "human",
    "Search intent: {query}\nVariations searched: {variations}\n\nListings (JSON):\n{listings}",
  ],
]);
