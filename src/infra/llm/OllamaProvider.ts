import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { RunnableLambda } from "@langchain/core/runnables";
import type { AIMessage } from "@langchain/core/messages";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import type { ILLMProvider } from "../../core/ports/index.js";
import {
  resolveModelProfile,
  type ModelProfile,
} from "../../core/models/index.js";

export interface OllamaProviderOptions {
  baseUrl: string;
  model: string;
  temperature: number;
  /** Overrides the profile's context window when set. */
  contextTokens?: number;
}

function isZodSchema(schema: unknown): schema is ZodTypeAny {
  return typeof (schema as ZodTypeAny)?.safeParse === "function";
}

// ChatOllama.withStructuredOutput usa tool calling, que modelos menores seguem
// de forma solta. Passar o schema em `format` faz o Ollama restringir a decodificação.
class SchemaConstrainedChatOllama extends ChatOllama {
  withStructuredOutput(outputSchema: any, _config?: any): any {
    const jsonSchema = isZodSchema(outputSchema)
      ? zodToJsonSchema(outputSchema)
      : outputSchema;

    return this.bind({ format: jsonSchema } as any).pipe(
      RunnableLambda.from((message: AIMessage) => {
        const text =
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content);
        const parsed = JSON.parse(text);
        return isZodSchema(outputSchema) ? outputSchema.parse(parsed) : parsed;
      }),
    );
  }
}

export class OllamaProvider implements ILLMProvider {
  private readonly model: SchemaConstrainedChatOllama;
  private readonly profile: ModelProfile;

  constructor(options: OllamaProviderOptions) {
    const resolved = resolveModelProfile("ollama", options.model);
    this.profile = options.contextTokens
      ? { ...resolved, contextTokens: options.contextTokens }
      : resolved;

    this.model = new SchemaConstrainedChatOllama({
      baseUrl: options.baseUrl,
      model: options.model,
      temperature: options.temperature,
      // Ollama trunca em 4k sem isso, silenciosamente.
      numCtx: this.profile.contextTokens,
    });
  }

  getModel(): BaseChatModel {
    return this.model as unknown as BaseChatModel;
  }

  getProfile(): ModelProfile {
    return this.profile;
  }
}
