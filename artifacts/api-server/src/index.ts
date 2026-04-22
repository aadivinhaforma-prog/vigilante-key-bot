import { execFile } from "child_process";
import { promisify } from "util";
import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot";

const execFileAsync = promisify(execFile);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Auto-atualiza yt-dlp na inicialização (item 1 da spec).
// Tenta vários gerenciadores: o que estiver disponível ganha. Se nenhum: ignora.
async function atualizarYtDlp(): Promise<void> {
  const tentativas: Array<[string, string[]]> = [
    ["yt-dlp", ["-U"]],
    ["pip", ["install", "-U", "--quiet", "yt-dlp"]],
    ["pip3", ["install", "-U", "--quiet", "yt-dlp"]],
    ["pipx", ["upgrade", "yt-dlp"]],
  ];
  for (const [bin, args] of tentativas) {
    try {
      await execFileAsync(bin, args, { timeout: 60000 });
      logger.info({ bin }, "yt-dlp verificado/atualizado");
      return;
    } catch { /* tenta o próximo */ }
  }
  logger.info("yt-dlp não pôde ser atualizado automaticamente (versão atual será usada)");
}

async function bootstrap() {
  await atualizarYtDlp();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  startBot();
}

bootstrap().catch((err) => {
  logger.error({ err }, "Falha no bootstrap");
  process.exit(1);
});
