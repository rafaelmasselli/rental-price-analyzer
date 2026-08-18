import type { AiCredentials } from "../../config/index.js";
import type {
  IEmbeddingProvider,
  ILLMProvider,
} from "../../core/ports/index.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { OllamaEmbeddingsProvider } from "./OllamaEmbeddingsProvider.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { VertexEmbeddingsProvider } from "./VertexEmbeddingsProvider.js";

export class LlmFactory {
  constructor(private readonly credentials: AiCredentials) {}

  createLlm(temperatureOverride?: number): ILLMProvider {
    const temperature = temperatureOverride ?? this.credentials.temperature;

    if (this.credentials.llmBackend === "ollama") {
      return new OllamaProvider({
        baseUrl: this.credentials.ollamaBaseUrl,
        model: this.credentials.ollamaModel,
        temperature,
        contextTokens: this.credentials.ollamaContextTokens ?? undefined,
      });
    }

    return new GeminiProvider({
      serviceAccount: this.requireServiceAccount("llmBackend"),
      location: this.credentials.location,
      model: this.credentials.model,
      temperature,
    });
  }

  createEmbeddings(): IEmbeddingProvider {
    if (this.credentials.embeddingBackend === "ollama") {
      return new OllamaEmbeddingsProvider({
        baseUrl: this.credentials.ollamaBaseUrl,
        model: this.credentials.ollamaEmbeddingModel,
      });
    }

    return new VertexEmbeddingsProvider({
      serviceAccount: this.requireServiceAccount("embeddingBackend"),
      location: this.credentials.location,
      model: this.credentials.embeddingModel,
    });
  }

  private requireServiceAccount(field: string) {
    const { serviceAccount } = this.credentials;
    if (!serviceAccount) {
      throw new Error(
        `${field} is "vertex" but ia-credentials.json has no GCP service account. ` +
          `Add the service account fields, or set "${field}": "ollama" to run locally.`,
      );
    }
    return serviceAccount;
  }
}
