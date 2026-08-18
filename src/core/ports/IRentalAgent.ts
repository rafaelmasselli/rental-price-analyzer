import type { RentalGraphState } from "../../shared/models/index.js";

export interface IRentalAgent {
  run(state: RentalGraphState): Promise<Partial<RentalGraphState>>;
}
