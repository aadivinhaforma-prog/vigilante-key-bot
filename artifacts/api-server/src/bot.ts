import { Client, GatewayIntentBits, Events } from "discord.js";
import { logger } from "./lib/logger";

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  logger.warn("DISCORD_BOT_TOKEN não está definido. O bot não será iniciado.");
}

export function startBot() {
  if (!token) return;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // As intents abaixo são PRIVILEGIADAS e precisam ser ativadas em:
      // https://discord.com/developers/applications -> seu bot -> "Bot" -> "Privileged Gateway Intents"
      // Descomente após ativar no painel:
      // GatewayIntentBits.MessageContent,
      // GatewayIntentBits.GuildMembers,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Bot online!");
  });

  // =============================================
  // COLOQUE O CÓDIGO DO SEU BOT AQUI
  // Exemplo:
  // client.on(Events.MessageCreate, (message) => {
  //   if (message.author.bot) return;
  //   if (message.content === "!ping") {
  //     message.reply("Pong!");
  //   }
  // });
  // =============================================

  client.login(token).catch((err) => {
    logger.error({ err }, "Falha ao fazer login no Discord");
  });

  return client;
}
