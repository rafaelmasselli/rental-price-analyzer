import type { LlmBackend } from "../models/index.js";

export interface EmbeddingDescriptor {
  backend: LlmBackend;
  model: string;
}

export interface IEmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
  describe(): EmbeddingDescriptor;
}
