import { OllamaEmbeddings } from "@langchain/ollama";
import type {
  EmbeddingDescriptor,
  IEmbeddingProvider,
} from "../../core/ports/index.js";

export interface OllamaEmbeddingsProviderOptions {
  baseUrl: string;
  model: string;
}

export class OllamaEmbeddingsProvider implements IEmbeddingProvider {
  private readonly embeddings: OllamaEmbeddings;
  private readonly model: string;

  constructor(options: OllamaEmbeddingsProviderOptions) {
    this.model = options.model;
    this.embeddings = new OllamaEmbeddings({
      baseUrl: options.baseUrl,
      model: options.model,
    });
  }

  describe(): EmbeddingDescriptor {
    return { backend: "ollama", model: this.model };
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embeddings.embedDocuments(texts);
  }
}
