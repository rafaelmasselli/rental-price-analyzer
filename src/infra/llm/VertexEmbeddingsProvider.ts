import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import type { IEmbeddingProvider } from "../../core/ports/index.js";
import type { ServiceAccountCredentials } from "../../config/index.js";

export interface VertexEmbeddingsProviderOptions {
  serviceAccount: ServiceAccountCredentials;
  location: string;
  model: string;
}

export class VertexEmbeddingsProvider implements IEmbeddingProvider {
  private readonly embeddings: VertexAIEmbeddings;

  constructor(options: VertexEmbeddingsProviderOptions) {
    this.embeddings = new VertexAIEmbeddings({
      model: options.model,
      location: options.location,
      authOptions: {
        projectId: options.serviceAccount.project_id,
        credentials: {
          client_email: options.serviceAccount.client_email,
          private_key: options.serviceAccount.private_key,
        },
      },
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embeddings.embedDocuments(texts);
  }
}
