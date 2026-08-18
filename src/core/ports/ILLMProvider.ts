import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelProfile } from "../models/index.js";

export interface ILLMProvider {
  getModel(): BaseChatModel;
  /** Which model this is and how its prompts should be written. */
  getProfile(): ModelProfile;
}
