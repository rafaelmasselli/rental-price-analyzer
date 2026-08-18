import type { GraphState } from "../../shared/models/index.js";

export interface IAgent {
  run(state: GraphState): Promise<Partial<GraphState>>;
}
