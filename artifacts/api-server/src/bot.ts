import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
} from "discord.js";
import fs from "fs";
import { logger } from "./lib/logger";
import { analyzeVideo, formatDuration } from "./videoAnalyzer";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  logger.warn("DISCORD_BOT_TOKEN não está definido. O bot não será iniciado.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("video")
    .setDescription("Analisa um vídeo: detecta músicas e transcreve a fala")
    .addStringOption((opt) =>
      opt
        .setName("link")
        .setDescription("Link do YouTube, TikTok ou Instagram")
        .setRequired(true)
    ),
];

async function registerCommands(botToken: string, appClientId: string) {
  const rest = new REST({ version: "10" }).setToken(botToken);
  try {
    await rest.put(Routes.applicationCommands(appClientId), {
      body: commands.map((c) => c.toJSON()),
    });
    logger.info("Comandos slash registrados globalmente.");
  } catch (err) {
    logger.error({ err }, "Erro ao registrar comandos slash");
  }
}

function buildVideoResponse(result: Awaited<ReturnType<typeof analyzeVideo>>): string {
  const { videoInfo, music, transcript } = result;

  let msg = `## 🎬 [${videoInfo.title}](${videoInfo.url})\n`;
  msg += `**📱 Plataforma:** ${videoInfo.platform} · ⏱️ ${formatDuration(videoInfo.duration)} · 🎙️ ${videoInfo.uploader}\n\n`;

  if (music.length > 0) {
    msg += `### 🎵 Músicas detectadas\n`;
    music.forEach((m, i) => {
      let line = `**${i + 1}.** ${m.title} — ${m.artist}`;
      if (m.album) line += ` (${m.album}`;
      if (m.releaseDate) line += `, ${m.releaseDate.slice(0, 4)}`;
      if (m.album) line += `)`;
      line += `\n> ⏩ aparece em \`${m.timestamp}\``;
      if (m.spotifyUrl) line += ` · [Spotify](${m.spotifyUrl})`;
      if (m.appleUrl) line += ` · [Apple Music](${m.appleUrl})`;
      msg += line + "\n";
    });
  } else {
    msg += `### 🎵 Músicas detectadas\n*Nenhuma música identificada neste vídeo.*\n`;
  }

  msg += "\n";

  if (transcript && transcript.trim().length > 0) {
    const maxLen = 900;
    const truncated =
      transcript.length > maxLen
        ? transcript.slice(0, maxLen) + "..."
        : transcript;
    msg += `### 🗣️ O que foi falado\n${truncated}\n\n`;
  } else {
    msg += `### 🗣️ O que foi falado\n*Nenhuma fala detectada.*\n\n`;
  }

  msg += `🔗 **Link original:** ${videoInfo.url}\n`;
  msg += `📥 **Baixar no celular:** https://snaptube.com`;

  if (msg.length > 2000) {
    msg = msg.slice(0, 1990) + "...";
  }

  return msg;
}

export function startBot() {
  if (!token) return;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Bot online!");

    const appClientId = clientId || readyClient.user.id;
    await registerCommands(token!, appClientId);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction as ChatInputCommandInteraction;

    if (cmd.commandName === "video") {
      const url = cmd.options.getString("link", true);

      await cmd.deferReply();

      try {
        const result = await analyzeVideo(url);
        const responseText = buildVideoResponse(result);

        if (result.videoFilePath && fs.existsSync(result.videoFilePath)) {
          const attachment = new AttachmentBuilder(result.videoFilePath);
          await cmd.editReply({ content: responseText, files: [attachment] });
          fs.unlinkSync(result.videoFilePath);
        } else {
          await cmd.editReply(responseText);
        }
      } catch (err) {
        logger.error({ err }, "Erro ao analisar vídeo");
        await cmd.editReply(
          "❌ Não consegui analisar este vídeo. Verifique se o link é válido e tente novamente."
        );
      }
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Falha ao fazer login no Discord");
  });

  return client;
}
