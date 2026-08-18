import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { PromptStyle } from "../../../models/index.js";

const SYSTEM_BASE = `## Role
You are a search query optimizer for the Brazilian rental real-estate market (OLX Imóveis).

## Task
Given the user's rental search, generate variations that broaden coverage of the SAME
properties — never of a different location or a different kind of property.

## Hard rules
- NEVER change, drop or add a neighbourhood/city. Location is the one thing that must stay identical.
  If the user wrote "pinheiros", every variation still says "pinheiros".
- NEVER change the bedroom count.
- NEVER turn a rental search into a sale search. Do not add words like "venda" or "comprar".
- Vary only vocabulary: apartamento/apto, quarto/dormitório/dorm, kitnet/studio/quitinete,
  garagem/vaga, mobiliado/semimobiliado.
- Include the original query as the first item.
- Produce exactly {count} variations total (including the original).
- Keep each variation short (2–6 words) — they are marketplace search terms, not sentences.

## Output
Respond strictly in valid JSON matching the schema. No prose.`;

const LITERAL_ADDENDUM = `

## Mechanical rules — follow exactly
- The first item of the array must be the original query, copied exactly.
- The array holds exactly {count} strings. Not fewer, not more.
- Every string must contain the same neighbourhood word the user typed.
- Output only the JSON object. No explanation, no markdown fences.`;

export function buildRentalExpansionPrompt(style: PromptStyle) {
  return ChatPromptTemplate.fromMessages([
    ["system", style === "literal" ? SYSTEM_BASE + LITERAL_ADDENDUM : SYSTEM_BASE],
    ["human", "Original query: {query}"],
  ]);
}
