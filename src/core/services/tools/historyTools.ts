import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  HistoryQueryService,
  HistoryResult,
} from "../../../infra/storage/index.js";

const ratingEnum = z.enum(["good_deal", "fair", "overpriced"]);

function summarizeListing(result: HistoryResult): Record<string, unknown> {
  return {
    listingId: result.listingId,
    title: result.title,
    query: result.query,
    price: result.price,
    rating: result.rating,
    deltaPercent: result.deltaPercent,
    estimatedFairTotal: result.estimatedFairTotal,
    components: result.componentsBreakdown,
    location: result.location,
    seenAt: result.timestamp,
    url: result.url,
    similarity: result.similarity,
  };
}

export function createHistoryTools(queryService: HistoryQueryService) {
  const searchHistory = tool(
    async ({ rating, query, days, minPrice, maxPrice, limit }) => {
      const results = await queryService.query({
        rating,
        query,
        days,
        minPrice,
        maxPrice,
        limit: limit ?? 10,
      });
      if (results.length === 0) return "No matching listings found.";
      return JSON.stringify(results.map(summarizeListing));
    },
    {
      name: "search_history",
      description:
        "Search the saved listings history with structured filters (rating, original search query string, time window in days, price range). Use this when the user gives concrete criteria.",
      schema: z.object({
        rating: ratingEnum.optional().describe("Filter by classification"),
        query: z
          .string()
          .optional()
          .describe("Filter by the original search query (e.g. 'kit am5')"),
        days: z.number().optional().describe("Limit to last N days"),
        minPrice: z.number().optional().describe("Minimum price in BRL"),
        maxPrice: z.number().optional().describe("Maximum price in BRL"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default 10)"),
      }),
    },
  );

  const semanticSearch = tool(
    async ({ text, rating, days, minPrice, maxPrice, limit }) => {
      const results = await queryService.query({
        similarTo: text,
        rating,
        days,
        minPrice,
        maxPrice,
        limit: limit ?? 8,
      });
      if (results.length === 0) {
        return "No semantically similar listings found in history.";
      }
      return JSON.stringify(results.map(summarizeListing));
    },
    {
      name: "semantic_search",
      description:
        "Find listings whose title/components are semantically similar to a free-text description, using embeddings (cosine similarity). Use this for fuzzy/contextual matches like 'memoria ram ddr5 rapida'. Returns results sorted by similarity.",
      schema: z.object({
        text: z.string().describe("Free-text description to match against"),
        rating: ratingEnum.optional(),
        days: z.number().optional(),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        limit: z.number().optional(),
      }),
    },
  );

  const getListingDetails = tool(
    async ({ listingId }) => {
      const results = await queryService.query({
        limit: 1,
        query: undefined,
      });
      const found = results.find((r) => r.listingId === listingId);
      if (!found) {
        const fallback = await queryService.query({ limit: 200 });
        const match = fallback.find((r) => r.listingId === listingId);
        if (!match) return `No listing with id ${listingId} found in history.`;
        return JSON.stringify(summarizeListing(match));
      }
      return JSON.stringify(summarizeListing(found));
    },
    {
      name: "get_listing_details",
      description:
        "Fetch the full latest snapshot for a specific listing by its listingId. Use after another search to get more context about one specific result.",
      schema: z.object({
        listingId: z.string().describe("The listingId returned by a previous search"),
      }),
    },
  );

  return [searchHistory, semanticSearch, getListingDetails];
}
