import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { IRentalAgent } from "../../ports/index.js";
import type {
  RentalAnalysis,
  RentalGraphState,
  RentalListing,
  RentalListingWithDelta,
  RentalSimilarMatch,
} from "../../../shared/models/index.js";

export interface RentalPipelineAgents {
  expansion: IRentalAgent;
  search: IRentalAgent;
  sanitization: IRentalAgent;
  normalization: IRentalAgent;
  refine: IRentalAgent;
  benchmark: IRentalAgent;
  history: IRentalAgent;
  analysis: IRentalAgent;
}

export class RentalPipeline {
  private static readonly state = Annotation.Root({
    query: Annotation<string>({
      reducer: (_prev, next) => next,
      default: () => "",
    }),
    expandedQueries: Annotation<string[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
    rawListings: Annotation<RentalListing[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
    listingsWithHistory: Annotation<RentalListingWithDelta[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
    analysis: Annotation<RentalAnalysis | null>({
      reducer: (_prev, next) => next,
      default: () => null,
    }),
    dbPath: Annotation<string>({
      reducer: (_prev, next) => next,
      default: () => "",
    }),
    similarListings: Annotation<RentalSimilarMatch[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
  });

  constructor(private readonly agents: RentalPipelineAgents) {}

  async run(
    query: string,
    expandedQueries: string[] = [],
  ): Promise<RentalGraphState> {
    const app = this.buildGraph();
    const result = await app.invoke({ query, expandedQueries });
    return result as unknown as RentalGraphState;
  }

  private buildGraph() {
    return new StateGraph(RentalPipeline.state)
      .addNode("expand", this.toNode(this.agents.expansion))
      .addNode("search", this.toNode(this.agents.search))
      .addNode("sanitize", this.toNode(this.agents.sanitization))
      .addNode("normalize", this.toNode(this.agents.normalization))
      .addNode("refine", this.toNode(this.agents.refine))
      .addNode("benchmark", this.toNode(this.agents.benchmark))
      .addNode("history", this.toNode(this.agents.history))
      .addNode("analyze", this.toNode(this.agents.analysis))
      .addEdge(START, "expand")
      .addEdge("expand", "search")
      .addEdge("search", "sanitize")
      .addEdge("sanitize", "normalize")
      .addEdge("normalize", "refine")
      .addEdge("refine", "benchmark")
      .addEdge("benchmark", "history")
      .addEdge("history", "analyze")
      .addEdge("analyze", END)
      .compile();
  }

  private toNode(agent: IRentalAgent) {
    return (state: typeof RentalPipeline.state.State) =>
      agent.run(state as unknown as RentalGraphState);
  }
}
