import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ILLMProvider } from "../ports/index.js";

const SYSTEM_PROMPT = `# Role
You are a helpful Brazilian PC parts shopping assistant.

# What you have
A SQLite database of OLX listings the user has been collecting over time. Each listing has:
- title, price (BRL), location, original search query, when seen
- rating: good_deal | fair | overpriced (computed from component-level fair value)
- deltaPercent: how the asking price compares to estimated fair total (negative = below fair)
- components: detailed breakdown like "cpu:Ryzen 5 7600X≈R$1100 | motherboard:B650M≈R$800"
- url to the actual OLX listing

# Tools
- search_history: structured filter by rating / query / days / price range
- semantic_search: fuzzy match by free-text description using embeddings
- get_listing_details: fetch one listing by ID

# How to behave
- Answer in Portuguese when the user writes in Portuguese.
- For any question about prices, deals, or recommendations: USE the tools to fetch real data from the user's history. Do NOT invent listings or prices.
- Be concrete. Cite price, location, delta percent, and URL when recommending.
- Be brief. Synthesize the data — do not dump raw JSON.
- If the user asks for a comparison (cheapest, best deal, etc.), use search_history with the right rating/sort.
- If the user asks something fuzzy ("memória rápida"), use semantic_search.
- If history is empty for the user's query, say so clearly and suggest running 'npm run dev'.
- Mark each listing recommendation with the rating symbol: ✓ good_deal, · fair, ✗ overpriced.
`;

export interface ChatServiceOptions {
  maxToolRounds?: number;
}

export class PriceChatService {
  private static readonly DEFAULT_MAX_TOOL_ROUNDS = 6;

  private readonly modelWithTools: Runnable;
  private readonly toolMap: Map<string, StructuredToolInterface>;
  private readonly history: BaseMessage[];
  private readonly maxToolRounds: number;

  constructor(
    llmProvider: ILLMProvider,
    tools: StructuredToolInterface[],
    options: ChatServiceOptions = {},
  ) {
    const model = llmProvider.getModel();
    if (!("bindTools" in model) || typeof model.bindTools !== "function") {
      throw new Error("The configured LLM does not support tool calling.");
    }
    this.modelWithTools = model.bindTools(tools) as Runnable;
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.history = [new SystemMessage(SYSTEM_PROMPT)];
    this.maxToolRounds =
      options.maxToolRounds ?? PriceChatService.DEFAULT_MAX_TOOL_ROUNDS;
  }

  async send(userInput: string): Promise<string> {
    this.history.push(new HumanMessage(userInput));

    let round = 0;
    let response = (await this.modelWithTools.invoke(this.history)) as AIMessage;

    while (
      response.tool_calls &&
      response.tool_calls.length > 0 &&
      round < this.maxToolRounds
    ) {
      round += 1;
      this.history.push(response);
      await this.runToolCalls(response);
      response = (await this.modelWithTools.invoke(this.history)) as AIMessage;
    }

    this.history.push(response);
    return this.extractText(response);
  }

  reset(): void {
    this.history.length = 1;
  }

  private async runToolCalls(response: AIMessage): Promise<void> {
    if (!response.tool_calls) return;

    for (const call of response.tool_calls) {
      const tool = this.toolMap.get(call.name);
      let content: string;
      if (!tool) {
        content = `Tool "${call.name}" not found.`;
      } else {
        try {
          const result = (await tool.invoke(call.args)) as string;
          content = typeof result === "string" ? result : JSON.stringify(result);
        } catch (error) {
          content = `Tool "${call.name}" failed: ${(error as Error).message}`;
        }
      }
      this.history.push(
        new ToolMessage({
          tool_call_id: call.id ?? call.name,
          name: call.name,
          content,
        }),
      );
    }
  }

  private extractText(message: AIMessage): string {
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return String(content);
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if ("text" in part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
}
