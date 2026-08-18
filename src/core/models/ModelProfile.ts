export type LlmBackend = "vertex" | "ollama";

export type PromptStyle = "concise" | "literal";

export interface ModelProfile {
  id: string;
  backend: LlmBackend;
  promptStyle: PromptStyle;
  /** Listings per LLM call. Larger batches are cheaper but risk truncation. */
  batchSize: number;
  /** Ollama truncates to 4k without this, silently. */
  contextTokens: number;
  /** Why this profile looks the way it does. Shown by `npm run models`. */
  notes: string;
}

interface ProfileRule {
  backend: LlmBackend;
  pattern: RegExp;
  profile: Omit<ModelProfile, "id" | "backend">;
}

const RULES: ProfileRule[] = [
  {
    backend: "vertex",
    pattern: /^gemini-(2\.5|3)/,
    profile: {
      promptStyle: "concise",
      batchSize: 20,
      contextTokens: 1_000_000,
      notes: "Frontier model: handles loose wording and large batches.",
    },
  },
  {
    backend: "vertex",
    pattern: /^gemini-/,
    profile: {
      promptStyle: "concise",
      batchSize: 20,
      contextTokens: 128_000,
      notes: "Older Gemini. Check availability — 2.0-flash-001 was retired.",
    },
  },
  {
    backend: "ollama",
    pattern: /^qwen2\.5:(14b|32b|72b)/,
    profile: {
      promptStyle: "literal",
      batchSize: 20,
      contextTokens: 16_384,
      notes:
        "Measured on the normalization task: 20/20 items, 0 invented fields, matched Gemini once prompts were made literal.",
    },
  },
  {
    backend: "ollama",
    pattern: /^(qwen3|qwen2\.5|llama3\.[123]|mistral-nemo|gemma[23])/,
    profile: {
      promptStyle: "literal",
      batchSize: 12,
      contextTokens: 16_384,
      notes: "Capable local model, untested here — conservative batch size.",
    },
  },
  {
    backend: "ollama",
    pattern: /coder/,
    profile: {
      promptStyle: "literal",
      batchSize: 12,
      contextTokens: 16_384,
      notes:
        "Code-tuned model: good at JSON, weaker at Portuguese prose and market judgement.",
    },
  },
];

const FALLBACK: Omit<ModelProfile, "id" | "backend"> = {
  promptStyle: "literal",
  batchSize: 8,
  contextTokens: 8_192,
  notes: "Unknown model — literal prompts and small batches until measured.",
};

export function resolveModelProfile(
  backend: LlmBackend,
  id: string,
): ModelProfile {
  const rule = RULES.find(
    (candidate) => candidate.backend === backend && candidate.pattern.test(id),
  );
  return { id, backend, ...(rule?.profile ?? FALLBACK) };
}

export function listKnownProfiles(): Array<{
  backend: LlmBackend;
  pattern: string;
  promptStyle: PromptStyle;
  batchSize: number;
}> {
  return RULES.map((rule) => ({
    backend: rule.backend,
    pattern: rule.pattern.source,
    promptStyle: rule.profile.promptStyle,
    batchSize: rule.profile.batchSize,
  }));
}
