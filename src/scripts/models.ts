import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CredentialsLoader, type AiCredentials } from "../config/index.js";
import {
  listKnownProfiles,
  resolveModelProfile,
} from "../core/models/index.js";
import { LlmFactory } from "../infra/llm/index.js";

interface OllamaTag {
  name: string;
  size: number;
  details?: { parameter_size?: string; quantization_level?: string };
}

async function listOllamaModels(baseUrl: string): Promise<OllamaTag[] | null> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: OllamaTag[] };
    return body.models ?? [];
  } catch {
    return null;
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function reportActive(credentials: AiCredentials): Promise<void> {
  const factory = new LlmFactory(credentials);

  console.log("=== Em uso agora ===");

  try {
    const profile = factory.createLlm().getProfile();
    console.log(`LLM         : ${profile.backend}/${profile.id}`);
    console.log(`  prompts   : ${profile.promptStyle}`);
    console.log(`  lote      : ${profile.batchSize} anúncios por chamada`);
    console.log(`  contexto  : ${profile.contextTokens.toLocaleString("pt-BR")} tokens`);
    console.log(`  perfil    : ${profile.notes}`);
  } catch (error) {
    console.log(`LLM         : ERRO — ${(error as Error).message}`);
  }

  try {
    const descriptor = factory.createEmbeddings().describe();
    console.log(`Embeddings  : ${descriptor.backend}/${descriptor.model}`);
  } catch (error) {
    console.log(`Embeddings  : ERRO — ${(error as Error).message}`);
  }
}

async function reportAvailability(credentials: AiCredentials): Promise<void> {
  console.log("\n=== Disponibilidade ===");

  const usesOllama =
    credentials.llmBackend === "ollama" ||
    credentials.embeddingBackend === "ollama";

  if (usesOllama) {
    const models = await listOllamaModels(credentials.ollamaBaseUrl);
    if (models === null) {
      console.log(
        `Ollama      : INACESSÍVEL em ${credentials.ollamaBaseUrl} (o servidor está rodando?)`,
      );
    } else {
      console.log(`Ollama      : OK em ${credentials.ollamaBaseUrl}`);
      const installed = new Set(models.map((model) => model.name));
      for (const [label, wanted] of [
        ["LLM", credentials.ollamaModel],
        ["embeddings", credentials.ollamaEmbeddingModel],
      ] as const) {
        const present =
          installed.has(wanted) || installed.has(`${wanted}:latest`);
        console.log(
          `  ${label.padEnd(11)}: ${wanted} ${present ? "instalado" : `AUSENTE — rode: ollama pull ${wanted}`}`,
        );
      }

      console.log("\n  Modelos instalados e o perfil que cada um receberia:");
      for (const model of models) {
        const profile = resolveModelProfile("ollama", model.name);
        console.log(
          `    ${model.name.padEnd(26)} ${formatGb(model.size).padStart(8)} · ${profile.promptStyle} · lote ${profile.batchSize}`,
        );
      }
    }
  }

  if (
    credentials.llmBackend === "vertex" ||
    credentials.embeddingBackend === "vertex"
  ) {
    const project = credentials.serviceAccount?.project_id ?? "sem credencial";
    console.log(`Vertex      : projeto ${project} · região ${credentials.location}`);
    console.log(`  modelo    : ${credentials.model}`);
    console.log(`  (disponibilidade real só é confirmada na primeira chamada)`);
  }
}

async function reportHistory(credentials: AiCredentials): Promise<void> {
  console.log("\n=== Histórico de aluguéis ===");

  const path = resolve(process.cwd(), credentials.rentalDbPath);
  const configured =
    credentials.embeddingBackend === "ollama"
      ? credentials.ollamaEmbeddingModel
      : credentials.embeddingModel;

  console.log(`Banco       : ${path}`);
  // Read-only on purpose: a diagnostic must not create the database.
  console.log(`  estado    : ${existsSync(path) ? "existe" : "ainda não criado"}`);
  console.log(`  embeddings configurados: ${configured}`);
  console.log(
    "  Um modelo de embedding diferente do que gravou o banco é recusado na próxima escrita.",
  );
}

function reportKnownProfiles(): void {
  console.log("\n=== Perfis conhecidos ===");
  const rows = [
    ...listKnownProfiles().map((rule) => ({
      left: `${rule.backend}  /${rule.pattern}/`,
      right: `${rule.promptStyle} · lote ${rule.batchSize}`,
    })),
    { left: "qualquer outro", right: "literal · lote 8 (fallback cauteloso)" },
  ];
  const width = Math.max(...rows.map((row) => row.left.length)) + 2;
  for (const row of rows) {
    console.log(`  ${row.left.padEnd(width)}${row.right}`);
  }
}

async function main(): Promise<void> {
  const credentials = await new CredentialsLoader().load();
  await reportActive(credentials);
  await reportAvailability(credentials);
  await reportHistory(credentials);
  reportKnownProfiles();
}

main().catch((error) => {
  console.error("models failed:", error);
  process.exit(1);
});
