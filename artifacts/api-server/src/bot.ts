import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ComponentType,
} from "discord.js";
import fs from "fs";
import { logger } from "./lib/logger";
import { analyzeVideo, formatDuration } from "./videoAnalyzer";
import { analyzeTrending, TrendingResult, calcChanceViral } from "./trendingAnalyzer";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  logger.warn("DISCORD_BOT_TOKEN não está definido. O bot não será iniciado.");
}

// Armazena as páginas de trending em memória por messageId
const trendingCache = new Map<string, { result: TrendingResult; page: number }>();

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

  new SlashCommandBuilder()
    .setName("trending")
    .setDescription("🔍 Vigilante: descobre o que está bombando agora")
    .addStringOption((opt) =>
      opt
        .setName("plataforma")
        .setDescription("Onde o bot vai caçar as tendências")
        .setRequired(true)
        .addChoices(
          { name: "YouTube", value: "YouTube" },
          { name: "YouTube Shorts", value: "YouTube Shorts" },
          { name: "TikTok", value: "TikTok" },
          { name: "Instagram Reels", value: "Instagram Reels" }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("categoria")
        .setDescription("Gênero do conteúdo (ex: Edição, Games, Piadas). Deixe vazio para top geral.")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("tema")
        .setDescription("Alvo específico (ex: Homem-Aranha, Blox Fruits). Complementa a categoria.")
        .setRequired(false)
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

// ─── /video ───────────────────────────────────────────────

function buildVideoResponse(result: Awaited<ReturnType<typeof analyzeVideo>>): string {
  const { videoInfo, music, transcript } = result;

  const chanceViral = calcChanceViral(videoInfo.views, 1);
  const viralBar = buildViralBar(chanceViral);
  const viewsStr = videoInfo.views >= 1_000_000
    ? `${(videoInfo.views / 1_000_000).toFixed(1)}M`
    : videoInfo.views >= 1_000
    ? `${(videoInfo.views / 1_000).toFixed(0)}K`
    : videoInfo.views > 0 ? String(videoInfo.views) : null;

  let msg = `## 🎬 [${videoInfo.title}](${videoInfo.url})\n`;
  msg += `**📱 Plataforma:** ${videoInfo.platform} · ⏱️ ${formatDuration(videoInfo.duration)} · 🎙️ ${videoInfo.uploader}`;
  if (viewsStr) msg += ` · 👁️ ${viewsStr} views`;
  msg += `\n\n`;
  msg += `**🎯 Chance de Viralizar:** ${viralBar}\n\n`;

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
    const truncated = transcript.length > maxLen ? transcript.slice(0, maxLen) + "..." : transcript;
    msg += `### 🗣️ O que foi falado\n${truncated}\n\n`;
  } else {
    msg += `### 🗣️ O que foi falado\n*Nenhuma fala detectada.*\n\n`;
  }

  msg += `🔗 **Link original:** ${videoInfo.url}`;

  if (msg.length > 2000) {
    msg = msg.slice(0, 1990) + "...";
  }

  return msg;
}

// ─── /trending ────────────────────────────────────────────

function buildViralBar(chance: number): string {
  const filled = Math.round(chance / 10);
  const empty = 10 - filled;
  const bar = "🟩".repeat(filled) + "⬛".repeat(empty);
  let label = "";
  if (chance >= 85) label = "🔥 ALTÍSSIMA";
  else if (chance >= 65) label = "⚡ ALTA";
  else if (chance >= 45) label = "📈 MÉDIA";
  else if (chance >= 25) label = "📊 BAIXA";
  else label = "❄️ FRIA";
  return `${bar} **${chance}%** — ${label}`;
}

function buildTrendingEmbed(result: TrendingResult, page: number): EmbedBuilder {
  const item = result.itens[page];
  const statusEmoji = item.status === "EXPLODINDO" ? "🚀" : "🔥";
  const statusColor = item.status === "EXPLODINDO" ? 0xff4500 : 0xffa500;

  const tituloSecao = result.tema
    ? `${result.categoria} · ${result.tema}`
    : result.categoria;

  const descricao = item.url
    ? `**[${item.titulo}](${item.url})**\n📺 Canal: \`${item.canal}\``
    : `**${item.titulo}**\n📺 Canal: \`${item.canal}\``;

  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`${statusEmoji} ${item.status} — #${item.rank} no ${result.plataforma}`)
    .setDescription(descricao)
    .addFields(
      {
        name: "🔍 Busca",
        value: tituloSecao,
        inline: true,
      },
      {
        name: "👁️ Views",
        value: `**${item.views}**`,
        inline: true,
      },
      {
        name: "📈 Crescimento Est.",
        value: `**${item.crescimento}**`,
        inline: true,
      },
      {
        name: "🎯 Chance de Viralizar",
        value: buildViralBar(item.chanceViral),
        inline: false,
      },
      {
        name: "🎵 Áudio Viral",
        value: item.audioViral,
        inline: false,
      },
      {
        name: "💡 Dica do Vigilante",
        value: `> ${item.dica}`,
        inline: false,
      }
    )
    .setFooter({
      text: `🕐 Atualizado em ${result.geradoEm} · Use os botões para navegar`,
    });

  return embed;
}

function buildTrendingButtons(page: number, total: number, messageId: string): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`trending_prev_${messageId}`)
      .setLabel("⬅️ Anterior")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`trending_page_${messageId}`)
      .setLabel(`${page + 1} / ${total}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`trending_next_${messageId}`)
      .setLabel("Próximo ➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === total - 1)
  );
  return row;
}

// ─── Bot ──────────────────────────────────────────────────

export function startBot() {
  if (!token) return;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Bot online!");
    const appClientId = clientId || readyClient.user.id;
    await registerCommands(token!, appClientId);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    // ── Slash Commands ──
    if (interaction.isChatInputCommand()) {
      const cmd = interaction as ChatInputCommandInteraction;

      // /video
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
          await cmd.editReply("❌ Não consegui analisar este vídeo. Verifique se o link é válido e tente novamente.");
        }
      }

      // /trending
      if (cmd.commandName === "trending") {
        const plataforma = cmd.options.getString("plataforma", true);
        const categoria = cmd.options.getString("categoria") || "";
        const tema = cmd.options.getString("tema") || "";

        await cmd.deferReply();

        try {
          const result = await analyzeTrending(plataforma, categoria, tema);

          const embed = buildTrendingEmbed(result, 0);

          // Envia primeiro sem buttons para pegar o messageId
          const reply = await cmd.editReply({ embeds: [embed] });
          const messageId = reply.id;

          // Armazena no cache
          trendingCache.set(messageId, { result, page: 0 });

          // Limpa cache após 30 minutos
          setTimeout(() => trendingCache.delete(messageId), 30 * 60 * 1000);

          // Atualiza com os botões usando o messageId
          const row = buildTrendingButtons(0, result.itens.length, messageId);
          await cmd.editReply({ embeds: [embed], components: [row] });

        } catch (err) {
          logger.error({ err }, "Erro ao buscar trending");
          await cmd.editReply("❌ Não consegui buscar as tendências agora. Tente novamente em alguns segundos.");
        }
      }
    }

    // ── Buttons ──
    if (interaction.isButton()) {
      const btn = interaction as ButtonInteraction;
      const customId = btn.customId;

      if (!customId.startsWith("trending_")) return;

      const parts = customId.split("_");
      const action = parts[1]; // "prev" | "next" | "page"
      const messageId = parts[2];

      const cached = trendingCache.get(messageId);
      if (!cached) {
        await btn.reply({ content: "⏳ Esta pesquisa expirou. Use `/trending` novamente.", ephemeral: true });
        return;
      }

      if (action === "page") return; // botão de página desabilitado, ignora

      let newPage = cached.page;
      if (action === "prev") newPage = Math.max(0, newPage - 1);
      if (action === "next") newPage = Math.min(cached.result.itens.length - 1, newPage + 1);

      cached.page = newPage;
      trendingCache.set(messageId, cached);

      const embed = buildTrendingEmbed(cached.result, newPage);
      const row = buildTrendingButtons(newPage, cached.result.itens.length, messageId);

      await btn.update({ embeds: [embed], components: [row] });
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Falha ao fazer login no Discord");
  });

  return client;
}
