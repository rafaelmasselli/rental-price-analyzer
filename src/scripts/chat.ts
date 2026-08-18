import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CredentialsLoader } from "../config/index.js";
import {
  createHistoryTools,
  PriceChatService,
} from "../core/services/index.js";
import {
  GeminiProvider,
  VertexEmbeddingsProvider,
} from "../infra/llm/index.js";
import { HistoryQueryService } from "../infra/storage/index.js";

const COMMANDS = {
  exit: ["sair", "exit", "quit", ":q"],
  reset: ["reset", "limpar", "/clear"],
  help: ["help", "ajuda", "/help"],
} as const;

function printIntro(): void {
  console.log(`
Chat com seu histórico de preços OLX.
Pergunte sobre os anúncios que você já coletou — exemplos:

  > qual o melhor kit am5 que vi até R$2000?
  > tem alguma memória ram ddr5 6000 com bom preço?
  > os anúncios com Ryzen 7 7700 caíram de preço essa semana?
  > o que comprar agora para upgrade AM5 entry-level?

Comandos: 'sair' para encerrar · 'reset' para limpar a conversa · 'help' para mais ajuda.
`);
}

function printHelp(): void {
  console.log(`
Você está conversando com um assistente que tem acesso ao seu banco SQLite
(data/history.sqlite) com todos os anúncios já coletados via "npm run dev".

Ele tem três ferramentas:
  - search_history  : filtros estruturados (rating, query, dias, faixa de preço)
  - semantic_search : busca por similaridade semântica via embeddings
  - get_listing_details : detalhes de um anúncio específico

Faça perguntas em linguagem natural. O assistente decide quais ferramentas usar.
`);
}

async function main(): Promise<void> {
  const credentials = await new CredentialsLoader().load();

  const llmProvider = new GeminiProvider({
    serviceAccount: credentials.serviceAccount,
    location: credentials.location,
    model: credentials.model,
    temperature: 0.4,
  });

  const embeddings = new VertexEmbeddingsProvider({
    serviceAccount: credentials.serviceAccount,
    location: credentials.location,
    model: credentials.embeddingModel,
  });

  const queryService = new HistoryQueryService(
    credentials.historyDbPath,
    embeddings,
  );

  const tools = createHistoryTools(queryService);
  const chat = new PriceChatService(llmProvider, tools);

  const rl = readline.createInterface({ input, output });
  printIntro();

  try {
    while (true) {
      const message = (await rl.question("\n> ")).trim();
      if (!message) continue;

      const lower = message.toLowerCase();
      if (COMMANDS.exit.includes(lower as (typeof COMMANDS.exit)[number])) {
        console.log("Até mais.");
        break;
      }
      if (COMMANDS.reset.includes(lower as (typeof COMMANDS.reset)[number])) {
        chat.reset();
        console.log("Conversa reiniciada.");
        continue;
      }
      if (COMMANDS.help.includes(lower as (typeof COMMANDS.help)[number])) {
        printHelp();
        continue;
      }

      try {
        const reply = await chat.send(message);
        console.log(`\n${reply}`);
      } catch (error) {
        console.error(`\n[erro] ${(error as Error).message}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Chat failed:", error);
  process.exit(1);
});
