import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { IAgent } from "../ports/index.js";
import type {
  GraphState,
  Listing,
  ListingWithDelta,
  PriceAnalysis,
  SimilarMatchState,
} from "../../shared/models/index.js";

export interface PipelineAgents {
  expansion: IAgent;
  search: IAgent;
  sanitization: IAgent;
  rating: IAgent;
  history: IAgent;
  analysis: IAgent;
}

export class Pipeline {
  private static readonly state = Annotation.Root({
    query: Annotation<string>({
      reducer: (_prev, next) => next,
      default: () => "",
    }),
    expandedQueries: Annotation<string[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
    rawListings: Annotation<Listing[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
    listingsWithHistory: Annotation<ListingWithDelta[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
    analysis: Annotation<PriceAnalysis | null>({
      reducer: (_prev, next) => next,
      default: () => null,
    }),
    csvPath: Annotation<string>({
      reducer: (_prev, next) => next,
      default: () => "",
    }),
    similarListings: Annotation<SimilarMatchState[]>({
      reducer: (_prev, next) => next,
      default: () => [],
    }),
  });

  constructor(private readonly agents: PipelineAgents) {}

  async run(query: string, expandedQueries: string[] = []): Promise<GraphState> {
    const app = this.buildGraph();
    const result = await app.invoke({ query, expandedQueries });
    return result as unknown as GraphState;
  }

  private buildGraph() {
    return new StateGraph(Pipeline.state)
      .addNode("expand", this.toNode(this.agents.expansion))
      .addNode("search", this.toNode(this.agents.search))
      .addNode("sanitize", this.toNode(this.agents.sanitization))
      .addNode("rate", this.toNode(this.agents.rating))
      .addNode("history", this.toNode(this.agents.history))
      .addNode("analyze", this.toNode(this.agents.analysis))
      .addEdge(START, "expand")
      .addEdge("expand", "search")
      .addEdge("search", "sanitize")
      .addEdge("sanitize", "rate")
      .addEdge("rate", "history")
      .addEdge("history", "analyze")
      .addEdge("analyze", END)
      .compile();
  }

  private toNode(agent: IAgent) {
    return (state: typeof Pipeline.state.State) =>
      agent.run(state as unknown as GraphState);
  }
}
