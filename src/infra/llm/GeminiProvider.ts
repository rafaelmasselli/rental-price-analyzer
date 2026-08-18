import { ChatVertexAI } from "@langchain/google-vertexai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ILLMProvider } from "../../core/ports/index.js";
import type { ServiceAccountCredentials } from "../../config/index.js";

export interface GeminiProviderOptions {
  serviceAccount: ServiceAccountCredentials;
  location: string;
  model: string;
  temperature: number;
}

export class GeminiProvider implements ILLMProvider {
  private readonly model: ChatVertexAI;

  constructor(options: GeminiProviderOptions) {
    this.model = new ChatVertexAI({
      model: options.model,
      location: options.location,
      temperature: options.temperature,
      authOptions: {
        projectId: options.serviceAccount.project_id,
        credentials: {
          client_email: options.serviceAccount.client_email,
          private_key: options.serviceAccount.private_key,
        },
      },
    });
  }

  getModel(): BaseChatModel {
    return this.model as unknown as BaseChatModel;
  }
}
