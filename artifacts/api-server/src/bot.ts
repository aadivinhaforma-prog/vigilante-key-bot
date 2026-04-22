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
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  Interaction,
} from "discord.js";
import fs from "fs";
import { logger } from "./lib/logger";
import {
  analyzeVideo,
  formatDuration,
  getVideoInfo,
  downloadVideoComWatermark,
  validarParaDownload,
  VideoValidationError,
  VideoInfo,
} from "./videoAnalyzer";
import { analyzeTrending, TrendingResult, calcChanceViral } from "./trendingAnalyzer";
import { preverViral, PrevisaoResult } from "./viralPredictor";
import { db, OWNER_ID, ensureUser, getUser, getSistema, setSistema, isManutencao, setManutencao } from "./lib/db";
import {
  validarLink,
  mensagemErroLink,
  checkAntiSpam,
  linkDuplicado,
  checkLimiteDiario,
  incrementaUsoDiario,
  checkLimiteCriador,
  incrementaCriador,
  isBloqueado,
  adicionarBloqueio,
  removerBloqueio,
  listarBloqueios,
  temConteudoProibido,
  classificarErroDownload,
} from "./lib/safety";
import {
  getFichas,
  podeGastar,
  gastarFicha,
  setFichas,
  addFichas,
  setFichasMax,
  setIntervaloHoras,
  setRecargaDias,
  resetarFichas,
  setVipInfinito,
  setVipDias,
  removerVip,
  listarVips,
  resetarTudo,
  formatTempo,
} from "./lib/fichas";
import {
  isOwner,
  isBotAdmin,
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  isServerAdmin,
} from "./lib/permissions";
import {
  setTrollEfeito,
  getTrollEfeito,
  listarTrolls,
  aplicarEfeitoTroll,
  TrollEfeito,
  EFEITOS_VALIDOS,
} from "./lib/troll";
import {
  adicionarHistorico,
  ultimosHistorico,
  topVirais,
  rankingMes,
  totalServidor,
  checarConquistas,
  listarConquistasUsuario,
  CONQUISTAS,
} from "./lib/historico";
import {
  registrarAcao,
  ultimasAcoes,
  historicoAcoes,
  desfazerAcao,
} from "./lib/acoes";
import {
  getConfig,
  setCanalPermitido,
  setLimiteDiario as setServerLimite,
  setDestino,
  setBloqueado,
  isServidorBloqueado,
  banirNoServidor,
  desbanirNoServidor,
  isBanidoNoServidor,
  listarServidores,
  statusDoDia,
} from "./lib/servidor";
import {
  eventosAtivos,
  criarEventoManual,
  listarEventosManuais,
  desligarEventosManuais,
  CATALOGO_EVENTOS,
} from "./lib/eventos";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const EPHEMERAL = MessageFlags.Ephemeral;

if (!token) {
  logger.warn("DISCORD_BOT_TOKEN não está definido. O bot não será iniciado.");
}

// ─── Caches em memória ───────────────────────────────────────

interface DownloadPending {
  url: string;
  userId: string;
  info: VideoInfo;
  guildId: string;
  expiresAt: number;
}
const pendingDownloads = new Map<string, DownloadPending>();
const trendingCache = new Map<string, { result: TrendingResult; page: number }>();
const ajudaPages = new Map<string, { paginas: EmbedBuilder[]; pagina: number; expiresAt: number }>();
const downloadsAtivos = new Map<string, number>(); // guildId → count
const MAX_DOWNLOADS_SIMULTANEOS = 3;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingDownloads) if (v.expiresAt < now) pendingDownloads.delete(k);
  for (const [k, v] of ajudaPages) if (v.expiresAt < now) ajudaPages.delete(k);
}, 60_000);

// ─── Helpers ─────────────────────────────────────────────────

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function fmtN(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n > 0 ? String(n) : "N/D";
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${b}B`;
}

function fmtData(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Extrai identificador normalizado de um link de criador (canal/perfil) */
function normalizarCriador(url: string, uploader?: string): string {
  if (uploader) return uploader.toLowerCase();
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube")) {
      const m = u.pathname.match(/\/(@[^/]+|c\/[^/]+|channel\/[^/]+|user\/[^/]+)/);
      if (m) return m[1].toLowerCase();
    }
    if (u.hostname.includes("tiktok")) {
      const m = u.pathname.match(/@([^/]+)/);
      if (m) return `@${m[1]}`.toLowerCase();
    }
    if (u.hostname.includes("instagram")) {
      const m = u.pathname.split("/").filter(Boolean);
      if (m[0]) return `@${m[0]}`.toLowerCase();
    }
  } catch { /* ignora */ }
  return url.toLowerCase();
}

// ─── Gates: chamado no início de TODA interação ──────────────

interface GateResult {
  ok: boolean;
  motivo?: string;
}

async function gateGeral(interaction: ChatInputCommandInteraction): Promise<GateResult> {
  // Item 25: ignora outros bots
  if (interaction.user.bot) return { ok: false, motivo: "bot" };
  // Item 26: apenas em servidores
  if (!interaction.guild) return { ok: false, motivo: "❌ O Vigilante Key só funciona dentro de servidores, não em DM." };

  // Item 79/80: manutenção (não bloqueia owner/admin)
  if (isManutencao() && !isBotAdmin(interaction.user.id)) {
    return { ok: false, motivo: "⚙️ Bot em manutenção. Voltamos em breve!" };
  }

  // Servidor bloqueado pelo owner
  if (isServidorBloqueado(interaction.guildId!) && !isBotAdmin(interaction.user.id)) {
    return { ok: false, motivo: "❌ Este servidor foi bloqueado pelo dono do bot." };
  }

  // Banimento global
  const user = ensureUser(interaction.user.id);
  if (user.banido_global && !isBotAdmin(interaction.user.id)) {
    return { ok: false, motivo: `❌ Você foi banido globalmente do bot${user.motivo_ban ? `: ${user.motivo_ban}` : ""}.` };
  }
  // Banimento no servidor
  if (isBanidoNoServidor(interaction.user.id, interaction.guildId!)) {
    return { ok: false, motivo: "❌ Você foi banido de usar o bot neste servidor." };
  }

  // Canal permitido (item 59)
  const config = getConfig(interaction.guildId!);
  if (
    config.canal_permitido &&
    interaction.channelId !== config.canal_permitido &&
    !isBotAdmin(interaction.user.id) &&
    !isServerAdmin(interaction)
  ) {
    return { ok: false, motivo: `❌ O bot só pode ser usado em <#${config.canal_permitido}> neste servidor.` };
  }

  return { ok: true };
}

/** Verifica anti-spam (item 22, 30) — chamar APÓS gate geral, ANTES do comando pesado */
function gateAntiSpam(userId: string): GateResult {
  const status = checkAntiSpam(userId);
  if (status.ok) return { ok: true };
  if (status.razao === "bloqueado") {
    const min = Math.ceil(status.segundos / 60);
    return { ok: false, motivo: `🚫 Você foi temporariamente bloqueado por uso suspeito. Aguarde ~${min}min.` };
  }
  return { ok: false, motivo: `⏳ Aguarde ${status.segundos}s entre comandos.` };
}

/**
 * Envia resposta aplicando efeitos de trollagem.
 * Retorna false se o efeito impede resposta (mudo/fantasma/infinito).
 */
async function respond(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  texto: string,
  options: { ephemeral?: boolean; embeds?: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] } = {}
): Promise<boolean> {
  const { efeito, apelido } = getTrollEfeito(interaction.user.id);
  const final = aplicarEfeitoTroll(efeito, apelido, texto);
  if (final === null) {
    // mudo/fantasma/infinito: silencioso. Mas precisa fechar o defer
    try {
      if ("deferred" in interaction && interaction.deferred) {
        // Não pode "cancelar" um defer; envia espaço em branco invisível
        await interaction.editReply({ content: "\u200b" });
      }
    } catch { /* ignora */ }
    return false;
  }

  const payload: any = { content: final };
  if (options.embeds) payload.embeds = options.embeds;
  if (options.components) payload.components = options.components;
  if (options.files) payload.files = options.files;
  if (options.ephemeral) payload.flags = EPHEMERAL;

  try {
    if (interaction.isChatInputCommand() || interaction.isButton()) {
      if ("deferred" in interaction && interaction.deferred) {
        await interaction.editReply(payload);
      } else if ("replied" in interaction && interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
  } catch (err) {
    logger.warn({ err, userId: interaction.user.id }, "Falha ao responder interação");
  }

  // Efeito "lento" e "contagem" são aplicados antes de chamar respond pelo caller
  return true;
}

// ─── Comandos ────────────────────────────────────────────────

const commands = [
  // /video
  new SlashCommandBuilder()
    .setName("video")
    .setDescription("Analisa um vídeo: detecta músicas e transcreve a fala")
    .addStringOption((opt) => opt.setName("link").setDescription("Link do YouTube, TikTok ou Instagram").setRequired(true))
    .addBooleanOption((opt) => opt.setName("receber_video").setDescription("Quer baixar o arquivo? (gasta 1 ficha)").setRequired(false)),

  // /prever
  new SlashCommandBuilder()
    .setName("prever")
    .setDescription("🔮 Tenta adivinhar se um vídeo/canal/live vai bombar")
    .addStringOption((opt) => opt.setName("link").setDescription("Link do vídeo, canal ou live").setRequired(true)),

  // /trending
  new SlashCommandBuilder()
    .setName("trending")
    .setDescription("🔍 Descobre o que está bombando agora")
    .addStringOption((opt) =>
      opt.setName("plataforma").setDescription("Onde caçar").setRequired(true)
        .addChoices(
          { name: "YouTube", value: "YouTube" },
          { name: "YouTube Shorts", value: "YouTube Shorts" },
          { name: "TikTok", value: "TikTok" },
          { name: "Instagram Reels", value: "Instagram Reels" }
        ))
    .addStringOption((opt) => opt.setName("categoria").setDescription("Gênero (ex: Edição, Games)").setRequired(false))
    .addStringOption((opt) => opt.setName("tema").setDescription("Alvo específico (ex: Homem-Aranha)").setRequired(false)),

  // /fichas
  new SlashCommandBuilder().setName("fichas").setDescription("🎫 Mostra suas fichas e tempo de recarga"),

  // /perfil
  new SlashCommandBuilder().setName("perfil").setDescription("👤 Mostra seu perfil: fichas, conquistas e total"),

  // /historico
  new SlashCommandBuilder().setName("historico").setDescription("📜 Seus últimos 5 vídeos analisados"),

  // /top
  new SlashCommandBuilder().setName("top").setDescription("🏆 Top 3 vídeos com mais chance de viralizar no servidor"),

  // /ranking
  new SlashCommandBuilder().setName("ranking").setDescription("🥇 Ranking dos usuários mais ativos do mês"),

  // /ajuda
  new SlashCommandBuilder().setName("ajuda").setDescription("📖 Como usar o bot"),
  new SlashCommandBuilder().setName("ajuda-adm").setDescription("📖 Comandos de administrador do servidor"),
  new SlashCommandBuilder().setName("ajuda-owner").setDescription("📖 Comandos do dono do bot"),

  // /adm — todos os subcomandos do administrador do servidor
  new SlashCommandBuilder()
    .setName("adm")
    .setDescription("Comandos de administrador do servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("banir").setDescription("Bane um usuário do bot neste servidor")
      .addUserOption((o) => o.setName("usuario").setDescription("Usuário").setRequired(true))
      .addStringOption((o) => o.setName("motivo").setDescription("Motivo (opcional)").setRequired(false)))
    .addSubcommand((s) => s.setName("desbanir").setDescription("Desbane um usuário")
      .addUserOption((o) => o.setName("usuario").setDescription("Usuário").setRequired(true)))
    .addSubcommand((s) => s.setName("fichas").setDescription("Adiciona fichas a um usuário")
      .addUserOption((o) => o.setName("usuario").setDescription("Usuário").setRequired(true))
      .addIntegerOption((o) => o.setName("quantidade").setDescription("Quantas fichas").setRequired(true).setMinValue(1).setMaxValue(50)))
    .addSubcommand((s) => s.setName("resetar").setDescription("Reseta as fichas de um usuário agora")
      .addUserOption((o) => o.setName("usuario").setDescription("Usuário").setRequired(true)))
    .addSubcommand((s) => s.setName("canal").setDescription("Define em qual canal o bot pode ser usado")
      .addChannelOption((o) => o.setName("canal").setDescription("Canal (deixe vazio para liberar todos)").setRequired(false).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName("log").setDescription("Mostra log de downloads (privado)"))
    .addSubcommand((s) => s.setName("limite").setDescription("Muda o limite diário de downloads")
      .addIntegerOption((o) => o.setName("numero").setDescription("Limite diário (padrão 50)").setRequired(true).setMinValue(1).setMaxValue(1000)))
    .addSubcommand((s) => s.setName("status").setDescription("Resumo do dia"))
    .addSubcommand((s) => s.setName("destino").setDescription("Onde o bot entrega resultados")
      .addStringOption((o) => o.setName("modo").setDescription("Onde entregar").setRequired(true)
        .addChoices({ name: "servidor", value: "servidor" }, { name: "canal", value: "canal" }, { name: "dm", value: "dm" }))
      .addChannelOption((o) => o.setName("canal").setDescription("Canal (só se modo=canal)").setRequired(false).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName("bloquear-criador").setDescription("Bloqueia um criador no servidor")
      .addStringOption((o) => o.setName("link").setDescription("Link do criador").setRequired(true)))
    .addSubcommand((s) => s.setName("bloquear-video").setDescription("Bloqueia um vídeo específico no servidor")
      .addStringOption((o) => o.setName("link").setDescription("Link do vídeo").setRequired(true)))
    .addSubcommand((s) => s.setName("desbloquear-criador").setDescription("Desbloqueia um criador")
      .addStringOption((o) => o.setName("link").setDescription("Link do criador").setRequired(true)))
    .addSubcommand((s) => s.setName("desbloquear-video").setDescription("Desbloqueia um vídeo")
      .addStringOption((o) => o.setName("link").setDescription("Link do vídeo").setRequired(true)))
    .addSubcommand((s) => s.setName("lista-bloqueios").setDescription("Lista todos os bloqueios do servidor"))
    .addSubcommand((s) => s.setName("desfazer").setDescription("Desfaz suas últimas ações")
      .addStringOption((o) => o.setName("quantidade").setDescription("Número ou 'tudo'").setRequired(true))),

  // /owner — todos os subcomandos do dono do bot
  new SlashCommandBuilder()
    .setName("owner")
    .setDescription("Comandos do dono do bot")
    .setDefaultMemberPermissions(0n)
    .addSubcommandGroup((g) => g.setName("admin").setDescription("Gerenciar admins do bot")
      .addSubcommand((s) => s.setName("addadmin").setDescription("Dá poderes de admin a uma pessoa")
        .addStringOption((o) => o.setName("id").setDescription("ID do Discord").setRequired(true)))
      .addSubcommand((s) => s.setName("removeadmin").setDescription("Remove poderes de admin")
        .addStringOption((o) => o.setName("id").setDescription("ID do Discord").setRequired(true)))
      .addSubcommand((s) => s.setName("listar").setDescription("Lista todos os admins do bot")))
    .addSubcommandGroup((g) => g.setName("geral").setDescription("Controle geral")
      .addSubcommand((s) => s.setName("banir").setDescription("Bane um usuário globalmente")
        .addStringOption((o) => o.setName("usuario_id").setDescription("ID do Discord").setRequired(true))
        .addStringOption((o) => o.setName("motivo").setDescription("Motivo").setRequired(false)))
      .addSubcommand((s) => s.setName("desbanir").setDescription("Remove banimento global")
        .addStringOption((o) => o.setName("usuario_id").setDescription("ID do Discord").setRequired(true)))
      .addSubcommand((s) => s.setName("mensagem").setDescription("Envia mensagem para servidor(es)")
        .addStringOption((o) => o.setName("texto").setDescription("Mensagem").setRequired(true))
        .addStringOption((o) => o.setName("servidor_id").setDescription("ID do servidor (vazio = todos)").setRequired(false)))
      .addSubcommand((s) => s.setName("resetar").setDescription("Reseta fichas (vazio = todos)")
        .addStringOption((o) => o.setName("usuario_id").setDescription("ID do usuário").setRequired(false))
        .addStringOption((o) => o.setName("servidor_id").setDescription("ID do servidor").setRequired(false)))
      .addSubcommand((s) => s.setName("desligar").setDescription("Desliga o bot (manutenção)"))
      .addSubcommand((s) => s.setName("ligar").setDescription("Liga o bot novamente"))
      .addSubcommand((s) => s.setName("status").setDescription("Estatísticas gerais")))
    .addSubcommandGroup((g) => g.setName("fichas").setDescription("Controle de fichas")
      .addSubcommand((s) => s.setName("custom").setDescription("Muda fichas de UM usuário")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true))
        .addIntegerOption((o) => o.setName("numero").setDescription("Quantas fichas").setRequired(true).setMinValue(0).setMaxValue(999)))
      .addSubcommand((s) => s.setName("global").setDescription("Muda fichas padrão de TODOS")
        .addIntegerOption((o) => o.setName("numero").setDescription("Quantas fichas").setRequired(true).setMinValue(1).setMaxValue(999)))
      .addSubcommand((s) => s.setName("tempo-custom").setDescription("Muda intervalo entre fichas de um usuário")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true))
        .addIntegerOption((o) => o.setName("horas").setDescription("Horas").setRequired(true).setMinValue(0).setMaxValue(168)))
      .addSubcommand((s) => s.setName("tempo-global").setDescription("Muda intervalo entre fichas para TODOS")
        .addIntegerOption((o) => o.setName("horas").setDescription("Horas").setRequired(true).setMinValue(0).setMaxValue(168)))
      .addSubcommand((s) => s.setName("dias-custom").setDescription("Muda recarga em dias de um usuário")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true))
        .addIntegerOption((o) => o.setName("dias").setDescription("Dias").setRequired(true).setMinValue(1).setMaxValue(365)))
      .addSubcommand((s) => s.setName("dias-global").setDescription("Muda recarga em dias para TODOS")
        .addIntegerOption((o) => o.setName("dias").setDescription("Dias").setRequired(true).setMinValue(1).setMaxValue(365)))
      .addSubcommand((s) => s.setName("reset-custom").setDescription("Reseta fichas de um usuário agora")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true)))
      .addSubcommand((s) => s.setName("reset-global").setDescription("Reseta fichas de TODOS agora")))
    .addSubcommandGroup((g) => g.setName("vip").setDescription("Sistema VIP")
      .addSubcommand((s) => s.setName("dar").setDescription("Dá VIP infinito a uma pessoa")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true)))
      .addSubcommand((s) => s.setName("estender").setDescription("Dá VIP por X dias")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true))
        .addIntegerOption((o) => o.setName("dias").setDescription("Dias").setRequired(true).setMinValue(1).setMaxValue(3650)))
      .addSubcommand((s) => s.setName("tirar").setDescription("Remove VIP de uma pessoa")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true)))
      .addSubcommand((s) => s.setName("sorteio").setDescription("Sorteia um VIP no servidor")
        .addStringOption((o) => o.setName("servidor_id").setDescription("ID do servidor (vazio = atual)").setRequired(false)))
      .addSubcommand((s) => s.setName("lista").setDescription("Lista todos os VIPs ativos")))
    .addSubcommandGroup((g) => g.setName("troll").setDescription("Efeitos de trollagem secretos")
      .addSubcommand((s) => s.setName("aplicar").setDescription("Aplica efeito de trollagem")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true))
        .addStringOption((o) => o.setName("efeito").setDescription("Efeito").setRequired(true)
          .addChoices(...EFEITOS_VALIDOS.map((e) => ({ name: e, value: e }))))
        .addStringOption((o) => o.setName("apelido").setDescription("Apelido (só para efeito 'apelido')").setRequired(false)))
      .addSubcommand((s) => s.setName("limpar").setDescription("Remove qualquer trollagem de um usuário")
        .addStringOption((o) => o.setName("id").setDescription("ID").setRequired(true)))
      .addSubcommand((s) => s.setName("lista").setDescription("Lista todos os trollados")))
    .addSubcommandGroup((g) => g.setName("servidor").setDescription("Controle de servidores")
      .addSubcommand((s) => s.setName("bloquear").setDescription("Bloqueia um servidor")
        .addStringOption((o) => o.setName("id").setDescription("ID do servidor").setRequired(true)))
      .addSubcommand((s) => s.setName("desbloquear").setDescription("Desbloqueia um servidor")
        .addStringOption((o) => o.setName("id").setDescription("ID do servidor").setRequired(true)))
      .addSubcommand((s) => s.setName("limite").setDescription("Muda o limite diário de um servidor")
        .addStringOption((o) => o.setName("id").setDescription("ID do servidor").setRequired(true))
        .addIntegerOption((o) => o.setName("numero").setDescription("Limite").setRequired(true).setMinValue(1).setMaxValue(1000)))
      .addSubcommand((s) => s.setName("lista").setDescription("Lista todos os servidores")))
    .addSubcommandGroup((g) => g.setName("bloqueio").setDescription("Bloquear criadores e vídeos")
      .addSubcommand((s) => s.setName("criador").setDescription("Bloqueia um criador")
        .addStringOption((o) => o.setName("link").setDescription("Link do criador").setRequired(true))
        .addStringOption((o) => o.setName("escopo").setDescription("global ou ID de usuário").setRequired(false)))
      .addSubcommand((s) => s.setName("video").setDescription("Bloqueia um vídeo")
        .addStringOption((o) => o.setName("link").setDescription("Link do vídeo").setRequired(true))
        .addStringOption((o) => o.setName("escopo").setDescription("global ou ID de usuário").setRequired(false)))
      .addSubcommand((s) => s.setName("desbloquear-criador").setDescription("Remove bloqueio de criador")
        .addStringOption((o) => o.setName("link").setDescription("Link").setRequired(true))
        .addStringOption((o) => o.setName("escopo").setDescription("global ou ID").setRequired(false)))
      .addSubcommand((s) => s.setName("desbloquear-video").setDescription("Remove bloqueio de vídeo")
        .addStringOption((o) => o.setName("link").setDescription("Link").setRequired(true))
        .addStringOption((o) => o.setName("escopo").setDescription("global ou ID").setRequired(false)))
      .addSubcommand((s) => s.setName("lista").setDescription("Lista TODOS os bloqueios")))
    .addSubcommandGroup((g) => g.setName("evento").setDescription("Sistema de eventos")
      .addSubcommand((s) => s.setName("ativar").setDescription("Ativa um evento do calendário")
        .addStringOption((o) => o.setName("nome").setDescription("Nome do evento").setRequired(true)
          .addChoices(...Object.keys(CATALOGO_EVENTOS).map((k) => ({ name: k, value: k }))))
        .addIntegerOption((o) => o.setName("horas").setDescription("Duração em horas (padrão 24)").setRequired(false).setMinValue(1).setMaxValue(720)))
      .addSubcommand((s) => s.setName("lista").setDescription("Lista eventos manuais ativos"))
      .addSubcommand((s) => s.setName("desligar").setDescription("Desliga todos os eventos manuais")))
    .addSubcommandGroup((g) => g.setName("sistema").setDescription("Sistema e desfazer")
      .addSubcommand((s) => s.setName("desfazer").setDescription("Desfaz suas últimas ações")
        .addStringOption((o) => o.setName("quantidade").setDescription("Número ou 'tudo'").setRequired(true)))
      .addSubcommand((s) => s.setName("historico").setDescription("Mostra suas últimas 10 ações"))
      .addSubcommand((s) => s.setName("banidos-lista").setDescription("Lista banidos globais"))),
];

async function registerCommands(botToken: string, appClientId: string) {
  const rest = new REST({ version: "10" }).setToken(botToken);
  try {
    await rest.put(Routes.applicationCommands(appClientId), {
      body: commands.map((c) => c.toJSON()),
    });
    logger.info({ count: commands.length }, "Comandos slash registrados globalmente.");
  } catch (err) {
    logger.error({ err }, "Erro ao registrar comandos slash");
  }
}

// ─── Embed builders ──────────────────────────────────────────

function buildVideoResponse(result: Awaited<ReturnType<typeof analyzeVideo>>): string {
  const { videoInfo, music, transcript } = result;
  const chanceViral = calcChanceViral(videoInfo.views, 1);
  const viralBar = buildViralBar(chanceViral);
  const viewsStr = videoInfo.views >= 1_000_000
    ? `${(videoInfo.views / 1_000_000).toFixed(1)}M`
    : videoInfo.views >= 1_000 ? `${(videoInfo.views / 1_000).toFixed(0)}K`
    : videoInfo.views > 0 ? String(videoInfo.views) : null;

  let msg = `## 🎬 ${videoInfo.title}\n`;
  msg += `**📱 Plataforma:** ${videoInfo.platform} · ⏱️ ${formatDuration(videoInfo.duration)} · 🎙️ @${videoInfo.uploaderHandle}`;
  if (viewsStr) msg += ` · 👁️ ${viewsStr} views`;
  msg += `\n\n**🎯 Chance de Viralizar:** ${viralBar}\n\n`;

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
    msg += `### 🎵 Músicas detectadas\n*Nenhuma música identificada.*\n`;
  }
  msg += "\n";

  if (transcript && transcript.trim().length > 0) {
    const maxLen = 900;
    const truncated = transcript.length > maxLen ? transcript.slice(0, maxLen) + "..." : transcript;
    msg += `### 🗣️ O que foi falado\n${truncated}\n\n`;
  } else {
    msg += `### 🗣️ O que foi falado\n*Nenhuma fala detectada.*\n\n`;
  }

  if (msg.length > 2000) msg = msg.slice(0, 1990) + "...";
  return msg;
}

function buildPrevisaoEmbed(p: PrevisaoResult): EmbedBuilder {
  const vai = p.veredicto === "VAI BOMBAR";
  const isCanal = p.tipo === "canal";
  const isLive = p.tipo === "live";
  const isShorts = p.plataforma === "YouTube Shorts";
  const color = isLive ? 0x9c27b0 : vai ? 0x00c853 : 0xff1744;
  const veredictoTexto = vai ? "✅ VAI BOMBAR" : "❌ NÃO VAI BOMBAR";
  const veredictoEmoji = vai ? "✅" : "❌";

  const filled = Math.round(p.confianca / 10);
  const bar = (vai ? "🟩" : "🟥").repeat(filled) + "⬛".repeat(10 - filled);

  let descricao: string;
  if (isLive) {
    const viewers = p.concurrentViewers ? fmtN(p.concurrentViewers) : "N/D";
    const inscritos = p.inscritos ? fmtN(p.inscritos) : "N/D";
    descricao = `**🔴 LIVE: ${p.titulo}**\n📺 \`${p.canal}\` · ${p.plataforma} · 👥 ${inscritos} inscritos\n🟢 **${viewers} espectadores ao vivo agora**`;
  } else if (isCanal) {
    const inscritos = p.inscritos ? fmtN(p.inscritos) : "N/D";
    descricao = `**📺 Canal: ${p.titulo}**\n👥 ${inscritos} inscritos · ${p.plataforma} · 👁️ ~${fmtN(p.views)} views/vídeo`;
  } else {
    descricao = `**${isShorts ? "🩳" : "🎬"} ${p.titulo}**\n📺 \`${p.canal}\` · ${p.plataforma} · 👁️ ${fmtN(p.views)} views`;
  }

  const tipoTexto = isLive ? "da live" : isCanal ? "do canal" : "do vídeo";
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🔮 PREVISÃO DO VIGILANTE — ${veredictoTexto}`)
    .setDescription(descricao)
    .addFields(
      { name: `${veredictoEmoji} Veredicto`, value: `**${p.veredicto}**\n${p.motivo}`, inline: false },
      { name: "📊 Confiança da Previsão", value: `${bar} **${p.confianca}%**`, inline: false },
      { name: "✔ Pontos Favoráveis", value: p.pontosFavoraveis.map((f) => `✔ ${f}`).join("\n") || "—", inline: true },
      { name: "✘ Pontos Contra", value: p.pontosContra.map((c) => `✘ ${c}`).join("\n") || "—", inline: true },
      { name: "💡 Como melhorar", value: `> ${p.dicaMelhora}`, inline: false }
    );

  if (p.sugestoesTitulos?.length > 0) {
    embed.addFields({ name: "✍️ Sugestões de Títulos",
      value: p.sugestoesTitulos.map((t, i) => `${i + 1}. ${t}`).join("\n") + "\n*⚠️ Sugestões do robô — não garantem viralização*",
      inline: false });
  }
  if (p.sugestoesTags?.length > 0) {
    embed.addFields({ name: "🏷️ Tags Sugeridas",
      value: p.sugestoesTags.map((t) => `\`${t}\``).join(" ") + "\n*⚠️ Sugestões do robô*",
      inline: false });
  }
  if (!isShorts && p.dicaThumbnail && p.dicaThumbnail !== "SHORTS_SEM_THUMBNAIL") {
    embed.addFields({ name: "🖼️ Dica de Thumbnail",
      value: `> ${p.dicaThumbnail}\n*⚠️ Sugestão do robô — resultados podem variar*`,
      inline: false });
  }
  if (isCanal && p.videosRecentes && p.videosRecentes.length > 0) {
    embed.addFields({ name: "🎬 Vídeos analisados", value: p.videosRecentes.slice(0, 5).join("\n"), inline: false });
  }
  embed.addFields({ name: "⚠️ Aviso do Robô",
    value: `Eu sou um robô e posso errar. Esta é apenas uma análise baseada nos dados ${tipoTexto}. **Nenhum bot ou IA consegue prever o futuro com 100% de certeza.** Use como referência, nunca como garantia.`,
    inline: false });
  embed.setFooter({ text: "🔮 Vigilante Key · Pode errar!" });
  return embed;
}

function buildViralBar(chance: number): string {
  const filled = Math.round(chance / 10);
  const bar = "🟩".repeat(filled) + "⬛".repeat(10 - filled);
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
  const tituloSecao = result.tema ? `${result.categoria} · ${result.tema}` : result.categoria;
  const descricao = item.url
    ? `**[${item.titulo}](${item.url})**\n📺 Canal: \`${item.canal}\``
    : `**${item.titulo}**\n📺 Canal: \`${item.canal}\``;
  return new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(`${statusEmoji} ${item.status} — #${item.rank} no ${result.plataforma}`)
    .setDescription(descricao)
    .addFields(
      { name: "🔍 Busca", value: tituloSecao, inline: true },
      { name: "👁️ Views", value: `**${item.views}**`, inline: true },
      { name: "📈 Crescimento Est.", value: `**${item.crescimento}**`, inline: true },
      { name: "🎯 Chance de Viralizar", value: buildViralBar(item.chanceViral), inline: false },
      { name: "🎵 Áudio Viral", value: item.audioViral, inline: false },
      { name: "💡 Dica do Vigilante", value: `> ${item.dica}`, inline: false }
    )
    .setFooter({ text: `🕐 Atualizado em ${result.geradoEm} · Use os botões para navegar` });
}

function buildTrendingButtons(page: number, total: number, messageId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`trending_prev_${messageId}`).setLabel("⬅️ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`trending_page_${messageId}`).setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`trending_next_${messageId}`).setLabel("Próximo ➡️").setStyle(ButtonStyle.Secondary).setDisabled(page === total - 1)
  );
}

// ─── /video — fluxo de download com confirmação ──────────────

async function handleVideo(cmd: ChatInputCommandInteraction): Promise<void> {
  const url = cmd.options.getString("link", true);
  const receberVideo = cmd.options.getBoolean("receber_video") ?? false;

  // Validar link (item 18, 19, 23, 27)
  const v = validarLink(url);
  if (!v.ok) {
    await respond(cmd, mensagemErroLink(v.erro), { ephemeral: true });
    return;
  }
  const cleanUrl = v.url;

  // Link duplicado (item 24)
  if (linkDuplicado(cmd.user.id, cleanUrl)) {
    await respond(cmd, "⚠️ Você já analisou esse vídeo recentemente.", { ephemeral: true });
    return;
  }

  await cmd.deferReply();
  await respond(cmd, "⏳ Analisando seu vídeo...");

  try {
    // Pega metadata primeiro (cheap, valida coisas básicas)
    const info = await getVideoInfo(cleanUrl);

    // Filtro de conteúdo proibido (item 15)
    if (temConteudoProibido(info.title)) {
      await respond(cmd, "❌ Esse conteúdo não é permitido pelas regras do bot.");
      return;
    }

    // Bloqueios (criador / vídeo) — itens 64-68 / 110-113
    const criadorNorm = normalizarCriador(cleanUrl, info.uploader);
    if (isBloqueado(criadorNorm, cmd.guildId, cmd.user.id) || isBloqueado(cleanUrl, cmd.guildId, cmd.user.id)) {
      await respond(cmd, "❌ Esse criador ou vídeo está bloqueado neste contexto.");
      return;
    }

    // Se não pediu vídeo: só análise, sem ficha
    if (!receberVideo) {
      const result = await analyzeVideo(cleanUrl, info);
      const responseText = buildVideoResponse(result);
      await respond(cmd, responseText);
      adicionarHistorico(cmd.user.id, info.title, info.platform, cmd.guildId, calcChanceViral(info.views, 1));
      return;
    }

    // ───── Quer baixar o arquivo: precisa ficha + confirmação ─────

    // Valida pra download (lives, duração, inscritos)
    try { validarParaDownload(info); }
    catch (err) {
      if (err instanceof VideoValidationError) { await respond(cmd, err.mensagem); return; }
      throw err;
    }

    // Limite diário do servidor (item 29)
    const limite = checkLimiteDiario(cmd.guildId!);
    if (!limite.ok) {
      await respond(cmd, `❌ Limite diário do servidor atingido (${limite.usado}/${limite.max}). Tente amanhã.`);
      return;
    }

    // Limite por criador (item 36)
    const limCriador = checkLimiteCriador(cmd.user.id, criadorNorm);
    if (!limCriador.ok) {
      await respond(cmd, "❌ Você já baixou 3 vídeos desse criador essa semana. Aguarde para baixar mais.");
      return;
    }

    // Downloads simultâneos (item 32)
    const ativos = downloadsAtivos.get(cmd.guildId!) || 0;
    if (ativos >= MAX_DOWNLOADS_SIMULTANEOS) {
      await respond(cmd, "⏳ Já tem 3 downloads acontecendo no servidor. Aguarde um terminar.");
      return;
    }

    // Verifica fichas
    const fichasInfo = getFichas(cmd.user.id);
    if (fichasInfo.fichas <= 0 && !fichasInfo.vipInfinito) {
      const tempo = fichasInfo.proximaRecarga ? formatTempo(fichasInfo.proximaRecarga.em) : "alguns dias";
      await respond(cmd, `❌ Você não tem fichas. Recarga em **${tempo}**. Use \`/fichas\` para ver detalhes.`);
      return;
    }

    // Mostra confirmação (item 11) com thumbnail (item 39) e tamanho (item 40)
    const confirmId = shortId();
    pendingDownloads.set(confirmId, {
      url: cleanUrl,
      userId: cmd.user.id,
      info,
      guildId: cmd.guildId!,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const tamanhoEst = info.fileSize ? fmtBytes(info.fileSize) : "desconhecido";
    const fichasRestantes = fichasInfo.vipInfinito ? "∞" : fichasInfo.fichas;
    const fichasMax = fichasInfo.vipInfinito ? "∞" : fichasInfo.fichasMax;

    let aviso = "";
    if (!fichasInfo.vipInfinito && fichasInfo.fichas === 1) {
      aviso = "\n\n⚠️ **Atenção: você tem apenas 1 ficha restante!**";
    }

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("🎬 Confirmar download?")
      .setDescription(`**${info.title}**\n📺 @${info.uploaderHandle} · ${info.platform} · ⏱️ ${formatDuration(info.duration)}\n📦 Tamanho estimado: ${tamanhoEst}\n\n🎫 **Fichas:** ${fichasRestantes}/${fichasMax}${aviso}`)
      .setFooter({ text: "Vai gastar 1 ficha · Marca d'água será aplicada" });
    if (info.thumbnail) embed.setThumbnail(info.thumbnail);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`dl_yes_${confirmId}`).setLabel("✅ Confirmar (gasta 1 ficha)").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`dl_no_${confirmId}`).setLabel("❌ Cancelar").setStyle(ButtonStyle.Secondary)
    );

    await cmd.editReply({ content: "", embeds: [embed], components: [row] });
  } catch (err) {
    logger.error({ err }, "Erro em /video");
    await respond(cmd, classificarErroDownload(err));
  }
}

async function handleDownloadConfirm(btn: ButtonInteraction, confirmId: string): Promise<void> {
  const pending = pendingDownloads.get(confirmId);
  if (!pending) {
    await btn.reply({ content: "⏳ Esta confirmação expirou. Use `/video` novamente.", flags: EPHEMERAL });
    return;
  }
  if (btn.user.id !== pending.userId) {
    await btn.reply({ content: "🚫 Esta confirmação não é sua.", flags: EPHEMERAL });
    return;
  }
  pendingDownloads.delete(confirmId);

  // Tenta gastar a ficha
  const status = gastarFicha(btn.user.id);
  if (!status.ok) {
    if (status.razao === "sem_fichas") {
      await btn.update({ content: "❌ Você não tem fichas. Use `/fichas` para ver detalhes.", embeds: [], components: [] });
    } else {
      await btn.update({ content: `⏳ Aguarde ${Math.ceil(status.segundos / 60)}min para usar a próxima ficha.`, embeds: [], components: [] });
    }
    return;
  }

  await btn.update({ content: "⏳ Baixando... aplicando marca d'água...", embeds: [], components: [] });

  const guildId = pending.guildId;
  downloadsAtivos.set(guildId, (downloadsAtivos.get(guildId) || 0) + 1);

  try {
    const [analysis, videoFile] = await Promise.all([
      analyzeVideo(pending.url, pending.info),
      downloadVideoComWatermark(pending.url, pending.info),
    ]);

    incrementaUsoDiario(guildId);
    incrementaCriador(btn.user.id, normalizarCriador(pending.url, pending.info.uploader));

    const responseText = buildVideoResponse(analysis);
    const aviso = "\n*🔒 Vídeo com marca d'água do criador original. Para uso pessoal apenas.*";
    const attachment = new AttachmentBuilder(videoFile);

    await btn.editReply({ content: responseText + aviso, files: [attachment] });
    try { fs.unlinkSync(videoFile); } catch { /* limpa */ }

    // Histórico + conquistas
    const chance = calcChanceViral(pending.info.views, 1);
    adicionarHistorico(btn.user.id, pending.info.title, pending.info.platform, guildId, chance);
    const user = ensureUser(btn.user.id);
    const novas = checarConquistas(btn.user.id, user.total_baixados);
    if (novas.length > 0) {
      const lista = novas.map((c) => `${c.emoji} **${c.nome}**`).join(", ");
      await btn.followUp({ content: `🎉 Conquista desbloqueada: ${lista}!`, flags: EPHEMERAL });
    }
  } catch (err) {
    // Devolve a ficha em caso de falha
    const u = ensureUser(btn.user.id);
    db.prepare("UPDATE users SET fichas = fichas + 1, total_baixados = MAX(0, total_baixados - 1) WHERE user_id = ?").run(btn.user.id);
    logger.error({ err }, "Falha no download");
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    await btn.editReply({ content: `${msg.startsWith("❌") ? msg : "❌ " + msg}\n*A ficha foi devolvida.*`, files: [] });
  } finally {
    const c = downloadsAtivos.get(guildId) || 1;
    if (c <= 1) downloadsAtivos.delete(guildId);
    else downloadsAtivos.set(guildId, c - 1);
  }
}

async function handleDownloadCancel(btn: ButtonInteraction, confirmId: string): Promise<void> {
  const pending = pendingDownloads.get(confirmId);
  if (pending && btn.user.id !== pending.userId) {
    await btn.reply({ content: "🚫 Esta confirmação não é sua.", flags: EPHEMERAL });
    return;
  }
  pendingDownloads.delete(confirmId);
  await btn.update({ content: "❌ Download cancelado.", embeds: [], components: [] });
}

// ─── /fichas, /perfil, /historico, /top, /ranking ────────────

async function handleFichas(cmd: ChatInputCommandInteraction): Promise<void> {
  const info = getFichas(cmd.user.id);
  let texto = `🎫 **Suas fichas:** ${info.vipInfinito ? "∞ (VIP infinito)" : `${info.fichas}/${info.fichasMax}`}\n`;

  if (!info.vipInfinito) {
    if (info.proximaFicha) {
      texto += `⏱️ Próxima ficha em: **${formatTempo(info.proximaFicha.em)}**\n`;
    }
    if (info.proximaRecarga) {
      texto += `🔄 Recarga total em: **${formatTempo(info.proximaRecarga.em)}**\n`;
    }
    if (info.fichas === info.fichasMax) {
      texto += `✅ Estoque cheio!\n`;
    }
  }

  texto += `\n⚙️ Configuração: ${info.intervaloHoras}h entre fichas · recarga em ${info.recargaDias} dias\n`;

  if (info.vipAtivo && !info.vipInfinito) texto += `\n🏆 **Você é VIP!** Fichas dobradas e sem espera.`;
  if (info.bonusFidelidade) texto += `\n💎 **Bônus de fidelidade ativo:** +1 ficha por usar há mais de 30 dias.`;
  if (info.eventos.length > 0) {
    texto += `\n\n${info.eventos.map((e) => e.mensagem).join("\n")}`;
  }

  await respond(cmd, texto, { ephemeral: true });
}

async function handlePerfil(cmd: ChatInputCommandInteraction): Promise<void> {
  const user = ensureUser(cmd.user.id);
  const info = getFichas(cmd.user.id);
  const conquistas = listarConquistasUsuario(cmd.user.id);

  const embed = new EmbedBuilder()
    .setColor(0x3f51b5)
    .setTitle(`👤 Perfil de ${cmd.user.username}`)
    .addFields(
      { name: "🎫 Fichas", value: info.vipInfinito ? "∞ (VIP)" : `${info.fichas}/${info.fichasMax}`, inline: true },
      { name: "📥 Total baixado", value: `${user.total_baixados}`, inline: true },
      { name: "👑 VIP", value: info.vipAtivo ? "✅" : "❌", inline: true },
      { name: "🏆 Conquistas", value: conquistas.length > 0 ? conquistas.map((c) => `${c.emoji} ${c.nome}`).join("\n") : "*Nenhuma ainda. Continue baixando!*", inline: false },
      { name: "📈 Próximas", value: CONQUISTAS.filter((c) => !conquistas.some((d) => d.nome === c.nome)).slice(0, 2).map((c) => `${c.emoji} ${c.nome} — ${user.total_baixados}/${c.meta}`).join("\n") || "*Todas desbloqueadas! 👑*", inline: false }
    )
    .setFooter({ text: `Membro desde ${fmtData(user.created_at)}` });
  if (info.bonusFidelidade) embed.addFields({ name: "💎 Bônus", value: "Fidelidade 30+ dias ativa", inline: false });
  await cmd.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function handleHistorico(cmd: ChatInputCommandInteraction): Promise<void> {
  const itens = ultimosHistorico(cmd.user.id, 5);
  if (itens.length === 0) {
    await respond(cmd, "📜 Você ainda não analisou nenhum vídeo.", { ephemeral: true });
    return;
  }
  const lista = itens.map((i, idx) => {
    const chance = i.chance_viral ? ` · 🎯 ${i.chance_viral}%` : "";
    return `**${idx + 1}.** ${i.titulo}\n   📱 ${i.plataforma} · 🕐 ${fmtData(i.baixado_em)}${chance}`;
  }).join("\n\n");
  await respond(cmd, `## 📜 Seus últimos 5 vídeos\n\n${lista}`, { ephemeral: true });
}

async function handleTop(cmd: ChatInputCommandInteraction): Promise<void> {
  const top = topVirais(cmd.guildId!, 3);
  if (top.length === 0) {
    await respond(cmd, "🏆 Ninguém analisou vídeos esta semana ainda.");
    return;
  }
  const medalhas = ["🥇", "🥈", "🥉"];
  const lista = top.map((t, i) => `${medalhas[i]} **${t.titulo}**\n   📱 ${t.plataforma} · 🎯 ${t.chance_viral}% chance`).join("\n\n");
  await respond(cmd, `## 🏆 Top 3 mais virais da semana\n\n${lista}\n\n*Total no servidor: ${totalServidor(cmd.guildId!)} vídeos analisados*`);
}

async function handleRanking(cmd: ChatInputCommandInteraction): Promise<void> {
  const rank = rankingMes(cmd.guildId!, 10);
  if (rank.length === 0) {
    await respond(cmd, "🥇 Ninguém entrou no ranking ainda esse mês.");
    return;
  }
  const linhas = await Promise.all(rank.map(async (r, i) => {
    const medalha = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
    let nome = `<@${r.user_id}>`;
    return `${medalha} ${nome} — **${r.total}** vídeos`;
  }));
  await respond(cmd, `## 🥇 Ranking do mês\n\n${linhas.join("\n")}`);
}

// ─── /ajuda (paginado) ───────────────────────────────────────

function buildAjudaUsuario(): EmbedBuilder[] {
  const p1 = new EmbedBuilder().setColor(0x2196f3).setTitle("📖 Ajuda — Página 1/2")
    .setDescription("**Comandos básicos do Vigilante Key**")
    .addFields(
      { name: "🎬 `/video link:URL receber_video:Sim/Não`", value: "Analisa um vídeo. Detecta músicas, transcreve a fala. Se `receber_video=Sim`, baixa o arquivo (gasta 1 ficha).\nExemplo: `/video link:https://youtu.be/abc123`", inline: false },
      { name: "🔮 `/prever link:URL`", value: "Analisa o potencial viral de um vídeo, canal ou live. Sugere títulos e tags.\nExemplo: `/prever link:https://youtube.com/@canal`", inline: false },
      { name: "🔍 `/trending plataforma:X`", value: "Mostra o que está bombando agora.\nExemplo: `/trending plataforma:YouTube categoria:Games`", inline: false },
    );
  const p2 = new EmbedBuilder().setColor(0x2196f3).setTitle("📖 Ajuda — Página 2/2")
    .setDescription("**Seu perfil e estatísticas**")
    .addFields(
      { name: "🎫 `/fichas`", value: "Mostra suas fichas e tempo de recarga.", inline: false },
      { name: "👤 `/perfil`", value: "Seu perfil completo: fichas, conquistas, total baixado.", inline: false },
      { name: "📜 `/historico`", value: "Últimos 5 vídeos que você analisou.", inline: false },
      { name: "🏆 `/top`", value: "Top 3 vídeos com maior chance de viralizar do servidor.", inline: false },
      { name: "🥇 `/ranking`", value: "Ranking dos usuários mais ativos do mês.", inline: false },
    );
  return [p1, p2];
}

function buildAjudaAdm(): EmbedBuilder[] {
  const p1 = new EmbedBuilder().setColor(0xff9800).setTitle("📖 Ajuda Admin — Página 1/2")
    .setDescription("**Comandos para administradores do servidor**\nRequer permissão **Gerenciar Servidor**.")
    .addFields(
      { name: "`/adm banir @usuario [motivo]`", value: "Bane um usuário do bot neste servidor.", inline: false },
      { name: "`/adm desbanir @usuario`", value: "Remove o banimento.", inline: false },
      { name: "`/adm fichas @usuario quantidade:X`", value: "Adiciona fichas a um usuário.", inline: false },
      { name: "`/adm resetar @usuario`", value: "Reseta as fichas de um usuário agora.", inline: false },
      { name: "`/adm canal #canal`", value: "Define o canal onde o bot funciona. Vazio = libera todos.", inline: false },
      { name: "`/adm log`", value: "Mostra log de downloads do servidor.", inline: false },
      { name: "`/adm limite numero:50`", value: "Muda o limite diário de downloads.", inline: false },
      { name: "`/adm status`", value: "Resumo do dia.", inline: false },
    );
  const p2 = new EmbedBuilder().setColor(0xff9800).setTitle("📖 Ajuda Admin — Página 2/2")
    .addFields(
      { name: "`/adm destino modo:servidor|canal|dm`", value: "Onde o bot entrega os resultados.", inline: false },
      { name: "`/adm bloquear-criador link:URL`", value: "Bloqueia um criador (YouTube/TikTok/Instagram) no servidor.", inline: false },
      { name: "`/adm bloquear-video link:URL`", value: "Bloqueia um vídeo específico.", inline: false },
      { name: "`/adm desbloquear-criador link:URL`", value: "Desbloqueia.", inline: false },
      { name: "`/adm desbloquear-video link:URL`", value: "Desbloqueia.", inline: false },
      { name: "`/adm lista-bloqueios`", value: "Lista todos os bloqueios do servidor.", inline: false },
      { name: "`/adm desfazer 1|tudo`", value: "Desfaz suas últimas ações (até 24h).", inline: false },
    );
  return [p1, p2];
}

function buildAjudaOwner(): EmbedBuilder[] {
  const p1 = new EmbedBuilder().setColor(0x9c27b0).setTitle("📖 Ajuda Owner — Página 1/3")
    .setDescription("**Comandos secretos do dono do bot**")
    .addFields(
      { name: "**👥 Admins**", value:
        "`/owner admin addadmin id:X` — dá poderes de admin\n" +
        "`/owner admin removeadmin id:X` — remove poderes\n" +
        "`/owner admin listar` — lista admins do bot", inline: false },
      { name: "**🌐 Geral**", value:
        "`/owner geral banir usuario_id:X [motivo]`\n" +
        "`/owner geral desbanir usuario_id:X`\n" +
        "`/owner geral mensagem texto:X [servidor_id]`\n" +
        "`/owner geral resetar [usuario_id] [servidor_id]`\n" +
        "`/owner geral desligar` / `ligar` / `status`", inline: false },
    );
  const p2 = new EmbedBuilder().setColor(0x9c27b0).setTitle("📖 Ajuda Owner — Página 2/3")
    .addFields(
      { name: "**🎫 Fichas**", value:
        "`/owner fichas custom id:X numero:N`\n" +
        "`/owner fichas global numero:N`\n" +
        "`/owner fichas tempo-custom id:X horas:N`\n" +
        "`/owner fichas tempo-global horas:N`\n" +
        "`/owner fichas dias-custom id:X dias:N`\n" +
        "`/owner fichas dias-global dias:N`\n" +
        "`/owner fichas reset-custom id:X` / `reset-global`", inline: false },
      { name: "**👑 VIP**", value:
        "`/owner vip dar id:X` — VIP infinito\n" +
        "`/owner vip estender id:X dias:N`\n" +
        "`/owner vip tirar id:X`\n" +
        "`/owner vip sorteio [servidor_id]`\n" +
        "`/owner vip lista`", inline: false },
    );
  const p3 = new EmbedBuilder().setColor(0x9c27b0).setTitle("📖 Ajuda Owner — Página 3/3")
    .addFields(
      { name: "**🤡 Trollagem**", value:
        "`/owner troll aplicar id:X efeito:Y [apelido]`\n" +
        `Efeitos: ${EFEITOS_VALIDOS.join(", ")}\n` +
        "`/owner troll limpar id:X` / `lista`", inline: false },
      { name: "**🏠 Servidores**", value:
        "`/owner servidor bloquear id:X` / `desbloquear`\n" +
        "`/owner servidor limite id:X numero:N`\n" +
        "`/owner servidor lista`", inline: false },
      { name: "**🚫 Bloqueios**", value:
        "`/owner bloqueio criador link:X [escopo]`\n" +
        "`/owner bloqueio video link:X [escopo]`\n" +
        "`escopo` = `global` ou ID de usuário (vazio = global)\n" +
        "`/owner bloqueio desbloquear-*` / `lista`", inline: false },
      { name: "**🎉 Eventos**", value:
        `\`/owner evento ativar nome:X horas:24\` — eventos: ${Object.keys(CATALOGO_EVENTOS).join(", ")}\n` +
        "`/owner evento lista` / `desligar`", inline: false },
      { name: "**⚙️ Sistema**", value:
        "`/owner sistema desfazer 1|tudo`\n" +
        "`/owner sistema historico`\n" +
        "`/owner sistema banidos-lista`", inline: false },
    );
  return [p1, p2, p3];
}

async function handleAjuda(cmd: ChatInputCommandInteraction, paginas: EmbedBuilder[]): Promise<void> {
  const id = shortId();
  ajudaPages.set(id, { paginas, pagina: 0, expiresAt: Date.now() + 10 * 60 * 1000 });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ajuda_prev_${id}`).setLabel("⬅️ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`ajuda_next_${id}`).setLabel("Próxima ➡️").setStyle(ButtonStyle.Secondary).setDisabled(paginas.length <= 1)
  );
  await cmd.reply({ embeds: [paginas[0]], components: [row], flags: EPHEMERAL });
}

// ─── /adm subcomandos ────────────────────────────────────────

async function handleAdm(cmd: ChatInputCommandInteraction): Promise<void> {
  if (!isServerAdmin(cmd) && !isBotAdmin(cmd.user.id)) {
    await respond(cmd, "❌ Você não tem permissão para usar esse comando.", { ephemeral: true });
    return;
  }
  const sub = cmd.options.getSubcommand();
  const guildId = cmd.guildId!;

  switch (sub) {
    case "banir": {
      const user = cmd.options.getUser("usuario", true);
      const motivo = cmd.options.getString("motivo");
      banirNoServidor(user.id, guildId, motivo);
      registrarAcao(cmd.user.id, "adm", guildId, `ban_servidor:${user.id}`, { user_id: user.id, guild_id: guildId, motivo });
      await respond(cmd, `🚫 <@${user.id}> banido do bot neste servidor.${motivo ? ` Motivo: ${motivo}` : ""}`, { ephemeral: true });
      return;
    }
    case "desbanir": {
      const user = cmd.options.getUser("usuario", true);
      if (!isBanidoNoServidor(user.id, guildId)) {
        await respond(cmd, "ℹ️ Esse usuário não está banido aqui.", { ephemeral: true });
        return;
      }
      desbanirNoServidor(user.id, guildId);
      registrarAcao(cmd.user.id, "adm", guildId, `desban_servidor:${user.id}`, { user_id: user.id, guild_id: guildId, banido_em: Date.now() });
      await respond(cmd, `✅ <@${user.id}> desbanido.`, { ephemeral: true });
      return;
    }
    case "fichas": {
      const user = cmd.options.getUser("usuario", true);
      const qtd = cmd.options.getInteger("quantidade", true);
      const u = ensureUser(user.id);
      addFichas(user.id, qtd);
      registrarAcao(cmd.user.id, "adm", guildId, `set_fichas:${user.id}`, { user_id: user.id, fichas_anterior: u.fichas });
      await respond(cmd, `✅ Adicionadas ${qtd} fichas para <@${user.id}>.`, { ephemeral: true });
      return;
    }
    case "resetar": {
      const user = cmd.options.getUser("usuario", true);
      const u = ensureUser(user.id);
      resetarFichas(user.id);
      registrarAcao(cmd.user.id, "adm", guildId, `set_fichas:${user.id}`, { user_id: user.id, fichas_anterior: u.fichas });
      await respond(cmd, `🔄 Fichas de <@${user.id}> resetadas.`, { ephemeral: true });
      return;
    }
    case "canal": {
      const canal = cmd.options.getChannel("canal");
      const cfgAntes = getConfig(guildId);
      setCanalPermitido(guildId, canal?.id ?? null);
      registrarAcao(cmd.user.id, "adm", guildId, `config_servidor:canal`, { guild_id: guildId, canal_permitido: cfgAntes.canal_permitido });
      await respond(cmd, canal ? `✅ Bot agora só funciona em <#${canal.id}>.` : `✅ Bot liberado em todos os canais.`, { ephemeral: true });
      return;
    }
    case "log": {
      const data = (() => {
        const d = new Date();
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      })();
      const rows = db.prepare(`SELECT user_id, titulo, plataforma, baixado_em FROM historico WHERE guild_id = ? ORDER BY baixado_em DESC LIMIT 20`).all(guildId) as any[];
      if (rows.length === 0) {
        await respond(cmd, "📋 Nenhum download registrado.", { ephemeral: true });
        return;
      }
      const lista = rows.map((r) => `\`${r.user_id}\` · ${r.plataforma} · ${fmtData(r.baixado_em)}`).join("\n");
      await respond(cmd, `📋 **Últimos 20 downloads (apenas IDs)**\n\n${lista}`, { ephemeral: true });
      return;
    }
    case "limite": {
      const num = cmd.options.getInteger("numero", true);
      const cfgAntes = getConfig(guildId);
      setServerLimite(guildId, num);
      registrarAcao(cmd.user.id, "adm", guildId, `config_servidor:limite`, { guild_id: guildId, limite_diario: cfgAntes.limite_diario });
      await respond(cmd, `✅ Limite diário ajustado para **${num}**.`, { ephemeral: true });
      return;
    }
    case "status": {
      const s = statusDoDia(guildId);
      await respond(cmd, `📊 **Status do dia**\n📥 Downloads hoje: **${s.downloads}**\n🚫 Banidos: **${s.bloqueados}**\n🎫 Fichas usadas hoje: **${s.fichas_usadas}**`, { ephemeral: true });
      return;
    }
    case "destino": {
      const modo = cmd.options.getString("modo", true) as "servidor" | "canal" | "dm";
      const canal = cmd.options.getChannel("canal");
      if (modo === "canal" && !canal) {
        await respond(cmd, "❌ Para modo `canal`, selecione um canal.", { ephemeral: true });
        return;
      }
      const cfgAntes = getConfig(guildId);
      setDestino(guildId, modo, canal?.id ?? null);
      registrarAcao(cmd.user.id, "adm", guildId, `config_servidor:destino`, { guild_id: guildId, destino_modo: cfgAntes.destino_modo, destino_canal: cfgAntes.destino_canal });
      await respond(cmd, `✅ Destino configurado: **${modo}**${canal ? ` (<#${canal.id}>)` : ""}.\n*Esta configuração é informativa por enquanto — implementação completa de roteamento em breve.*`, { ephemeral: true });
      return;
    }
    case "bloquear-criador":
    case "bloquear-video": {
      const tipo = sub === "bloquear-criador" ? "criador" : "video";
      const link = cmd.options.getString("link", true);
      const id = adicionarBloqueio(tipo, link, `servidor:${guildId}`, cmd.user.id);
      registrarAcao(cmd.user.id, "adm", guildId, `bloqueio:${tipo}`, { id });
      await respond(cmd, `🚫 ${tipo === "criador" ? "Criador" : "Vídeo"} bloqueado neste servidor.`, { ephemeral: true });
      return;
    }
    case "desbloquear-criador":
    case "desbloquear-video": {
      const tipo = sub === "desbloquear-criador" ? "criador" : "video";
      const link = cmd.options.getString("link", true);
      const escopo = `servidor:${guildId}`;
      const existing = db.prepare(`SELECT * FROM bloqueios WHERE tipo = ? AND LOWER(identificador) = ? AND escopo = ?`)
        .get(tipo, link.toLowerCase(), escopo) as any;
      const ok = removerBloqueio(tipo, link, escopo);
      if (ok && existing) registrarAcao(cmd.user.id, "adm", guildId, `desbloqueio:${tipo}`, existing);
      await respond(cmd, ok ? "✅ Bloqueio removido." : "ℹ️ Não havia esse bloqueio.", { ephemeral: true });
      return;
    }
    case "lista-bloqueios": {
      const lista = listarBloqueios(`servidor:${guildId}`);
      if (lista.length === 0) {
        await respond(cmd, "📋 Nenhum bloqueio neste servidor.", { ephemeral: true });
        return;
      }
      const txt = lista.map((b) => `\`${b.tipo}\` — ${b.identificador}`).join("\n");
      await respond(cmd, `📋 **Bloqueios deste servidor**\n${txt}`, { ephemeral: true });
      return;
    }
    case "desfazer": {
      await desfazerHandler(cmd, "adm", cmd.user.id);
      return;
    }
  }
}

async function desfazerHandler(cmd: ChatInputCommandInteraction, tipo: "adm" | "owner", atorId: string): Promise<void> {
  const qtdStr = cmd.options.getString("quantidade", true).toLowerCase();
  let n: number;
  if (qtdStr === "tudo") n = 999;
  else { n = parseInt(qtdStr); if (isNaN(n) || n < 1) { await respond(cmd, "❌ Use um número ou 'tudo'.", { ephemeral: true }); return; } }

  const acoes = ultimasAcoes(atorId, tipo, n);
  if (acoes.length === 0) {
    await respond(cmd, "ℹ️ Nenhuma ação para desfazer nas últimas 24h.", { ephemeral: true });
    return;
  }

  let desfeitas = 0;
  for (const a of acoes) {
    if (desfazerAcao(a)) desfeitas++;
  }
  await respond(cmd, `✅ **${desfeitas}** de ${acoes.length} ações desfeitas.`, { ephemeral: true });
}

// ─── /owner subcomandos ──────────────────────────────────────

async function handleOwner(cmd: ChatInputCommandInteraction): Promise<void> {
  if (!isBotAdmin(cmd.user.id)) {
    // Item 275: bot ignora completamente. Não responde nada.
    try { await cmd.reply({ content: "❌ Comando não disponível.", flags: EPHEMERAL }); } catch { /* ignora */ }
    return;
  }
  const group = cmd.options.getSubcommandGroup(true);
  const sub = cmd.options.getSubcommand();
  const userId = cmd.user.id;

  // ── admin ──
  if (group === "admin") {
    if (sub === "addadmin") {
      const id = cmd.options.getString("id", true);
      if (!isOwner(userId)) { await respond(cmd, "❌ Apenas o dono pode gerenciar admins.", { ephemeral: true }); return; }
      addBotAdmin(id, userId);
      registrarAcao(userId, "owner", null, `addadmin:${id}`, { user_id: id });
      await respond(cmd, `✅ <@${id}> agora é admin do bot.`, { ephemeral: true });
      return;
    }
    if (sub === "removeadmin") {
      const id = cmd.options.getString("id", true);
      if (!isOwner(userId)) { await respond(cmd, "❌ Apenas o dono pode gerenciar admins.", { ephemeral: true }); return; }
      if (id === OWNER_ID) { await respond(cmd, "❌ Você não pode remover o dono do bot.", { ephemeral: true }); return; }
      const existing = db.prepare(`SELECT adicionado_em, adicionado_por FROM admins_bot WHERE user_id = ?`).get(id) as any;
      const ok = removeBotAdmin(id);
      if (ok && existing) registrarAcao(userId, "owner", null, `removeadmin:${id}`, { user_id: id, ...existing });
      await respond(cmd, ok ? `✅ <@${id}> não é mais admin.` : "ℹ️ Essa pessoa não é admin.", { ephemeral: true });
      return;
    }
    if (sub === "listar") {
      const lista = listBotAdmins();
      const txt = lista.length === 0 ? "*Nenhum admin além do dono.*" :
        lista.map((a) => `<@${a.user_id}> · ${fmtData(a.adicionado_em)}`).join("\n");
      await respond(cmd, `## 👥 Admins do bot\n\n👑 <@${OWNER_ID}> (dono)\n${txt}`, { ephemeral: true });
      return;
    }
  }

  // ── geral ──
  if (group === "geral") {
    if (sub === "banir") {
      const id = cmd.options.getString("usuario_id", true);
      const motivo = cmd.options.getString("motivo");
      ensureUser(id);
      db.prepare(`UPDATE users SET banido_global = 1, motivo_ban = ? WHERE user_id = ?`).run(motivo, id);
      registrarAcao(userId, "owner", null, `ban_global:${id}`, { user_id: id });
      await respond(cmd, `🚫 <@${id}> banido globalmente.${motivo ? ` Motivo: ${motivo}` : ""}`, { ephemeral: true });
      return;
    }
    if (sub === "desbanir") {
      const id = cmd.options.getString("usuario_id", true);
      const u = getUser(id);
      db.prepare(`UPDATE users SET banido_global = 0, motivo_ban = NULL WHERE user_id = ?`).run(id);
      registrarAcao(userId, "owner", null, `desban_global:${id}`, { user_id: id, motivo: u?.motivo_ban ?? null });
      await respond(cmd, `✅ <@${id}> desbanido globalmente.`, { ephemeral: true });
      return;
    }
    if (sub === "mensagem") {
      const texto = cmd.options.getString("texto", true);
      const servidorId = cmd.options.getString("servidor_id");
      const client = cmd.client;
      const guilds = servidorId ? [client.guilds.cache.get(servidorId)].filter(Boolean) : [...client.guilds.cache.values()];
      let enviados = 0;
      for (const g of guilds) {
        if (!g) continue;
        try {
          const channel = g.systemChannel ?? g.channels.cache.find((c) => c.isTextBased() && c.permissionsFor(g.members.me!)?.has(PermissionFlagsBits.SendMessages));
          if (channel && "send" in channel) {
            await channel.send(`📢 **Mensagem do dono do bot:**\n${texto}`);
            enviados++;
          }
        } catch { /* ignora */ }
      }
      await respond(cmd, `✅ Mensagem enviada para ${enviados} servidor(es).`, { ephemeral: true });
      return;
    }
    if (sub === "resetar") {
      const id = cmd.options.getString("usuario_id");
      if (id) {
        resetarFichas(id);
        await respond(cmd, `🔄 Fichas de <@${id}> resetadas.`, { ephemeral: true });
      } else {
        resetarTudo();
        await respond(cmd, `🔄 Fichas de TODOS os usuários resetadas.`, { ephemeral: true });
      }
      return;
    }
    if (sub === "desligar") {
      setManutencao(true);
      await respond(cmd, `⚙️ Bot em modo manutenção. Apenas admins podem usar.`, { ephemeral: true });
      return;
    }
    if (sub === "ligar") {
      setManutencao(false);
      await respond(cmd, `✅ Bot ativo novamente.`, { ephemeral: true });
      return;
    }
    if (sub === "status") {
      const totalUsers = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
      const totalGuilds = cmd.client.guilds.cache.size;
      const totalDownloads = (db.prepare(`SELECT SUM(total_baixados) AS s FROM users`).get() as { s: number | null }).s ?? 0;
      const banidos = (db.prepare(`SELECT COUNT(*) AS c FROM users WHERE banido_global = 1`).get() as { c: number }).c;
      await respond(cmd, `## 📊 Status Geral\n\n👥 **Usuários:** ${totalUsers}\n🏠 **Servidores:** ${totalGuilds}\n📥 **Downloads totais:** ${totalDownloads}\n🚫 **Banidos globais:** ${banidos}\n⚙️ **Manutenção:** ${isManutencao() ? "ATIVA" : "inativa"}`, { ephemeral: true });
      return;
    }
  }

  // ── fichas ──
  if (group === "fichas") {
    if (sub === "custom") {
      const id = cmd.options.getString("id", true);
      const num = cmd.options.getInteger("numero", true);
      const u = ensureUser(id);
      setFichas(id, num);
      registrarAcao(userId, "owner", null, `set_fichas:${id}`, { user_id: id, fichas_anterior: u.fichas });
      await respond(cmd, `✅ Fichas de <@${id}> definidas para **${num}**.`, { ephemeral: true });
      return;
    }
    if (sub === "global") {
      const num = cmd.options.getInteger("numero", true);
      setSistema("fichas_global", String(num));
      await respond(cmd, `✅ Fichas padrão globais agora são **${num}**. (afeta novos usuários)`, { ephemeral: true });
      return;
    }
    if (sub === "tempo-custom") {
      const id = cmd.options.getString("id", true);
      const horas = cmd.options.getInteger("horas", true);
      ensureUser(id);
      setIntervaloHoras(id, horas);
      await respond(cmd, `✅ Intervalo entre fichas de <@${id}> = **${horas}h**.`, { ephemeral: true });
      return;
    }
    if (sub === "tempo-global") {
      const horas = cmd.options.getInteger("horas", true);
      setSistema("intervalo_global", String(horas));
      await respond(cmd, `✅ Intervalo global = **${horas}h** (novos usuários).`, { ephemeral: true });
      return;
    }
    if (sub === "dias-custom") {
      const id = cmd.options.getString("id", true);
      const dias = cmd.options.getInteger("dias", true);
      ensureUser(id);
      setRecargaDias(id, dias);
      await respond(cmd, `✅ Recarga de <@${id}> = **${dias} dias**.`, { ephemeral: true });
      return;
    }
    if (sub === "dias-global") {
      const dias = cmd.options.getInteger("dias", true);
      setSistema("dias_global", String(dias));
      await respond(cmd, `✅ Recarga global = **${dias} dias**.`, { ephemeral: true });
      return;
    }
    if (sub === "reset-custom") {
      const id = cmd.options.getString("id", true);
      ensureUser(id);
      resetarFichas(id);
      await respond(cmd, `🔄 Fichas de <@${id}> resetadas.`, { ephemeral: true });
      return;
    }
    if (sub === "reset-global") {
      resetarTudo();
      await respond(cmd, `🔄 Fichas de TODOS resetadas.`, { ephemeral: true });
      return;
    }
  }

  // ── vip ──
  if (group === "vip") {
    if (sub === "dar") {
      const id = cmd.options.getString("id", true);
      ensureUser(id);
      setVipInfinito(id, true);
      try { await cmd.client.users.send(id, `👑 **Parabéns!** Você ganhou **VIP infinito** no Vigilante Key!\n\n✨ Fichas ilimitadas\n⏱️ Sem espera entre fichas\n🏆 Tag VIP no perfil`); } catch { /* ignora */ }
      await respond(cmd, `👑 <@${id}> agora é VIP infinito.`, { ephemeral: true });
      return;
    }
    if (sub === "estender") {
      const id = cmd.options.getString("id", true);
      const dias = cmd.options.getInteger("dias", true);
      ensureUser(id);
      setVipDias(id, dias);
      try {
        await cmd.client.users.send(id, `👑 **Parabéns!** Você ganhou **${dias} dias de VIP** no Vigilante Key!\n\n✨ Fichas dobradas (6 em vez de 3)\n⏱️ Sem espera entre fichas\n🔄 Recarga em 3 dias\n🏆 Tag VIP no perfil\n\nUse \`/perfil\` para conferir!`);
      } catch { /* ignora */ }
      await respond(cmd, `👑 <@${id}> ganhou **${dias} dias** de VIP.`, { ephemeral: true });
      return;
    }
    if (sub === "tirar") {
      const id = cmd.options.getString("id", true);
      removerVip(id);
      await respond(cmd, `✅ VIP de <@${id}> removido.`, { ephemeral: true });
      return;
    }
    if (sub === "sorteio") {
      const servidorId = cmd.options.getString("servidor_id") ?? cmd.guildId!;
      const guild = cmd.client.guilds.cache.get(servidorId);
      if (!guild) { await respond(cmd, "❌ Servidor não encontrado.", { ephemeral: true }); return; }
      // Sem intent privilegiado: usa cache local; se vazio, tenta puxar da API
      let members = guild.members.cache;
      if (members.size <= 1) {
        try { members = await guild.members.fetch(); } catch { /* sem permissão */ }
      }
      const humanos = members.filter((m) => !m.user.bot);
      if (humanos.size === 0) { await respond(cmd, "❌ Nenhum membro humano.", { ephemeral: true }); return; }
      const arr = [...humanos.values()];
      const sorteado = arr[Math.floor(Math.random() * arr.length)];
      ensureUser(sorteado.id);
      setVipDias(sorteado.id, 30);
      try { await sorteado.user.send(`👑 **VIP por 30 dias!**\nVocê foi sorteado no **${guild.name}** e ganhou VIP no Vigilante Key!\n\n✨ Fichas dobradas\n⏱️ Sem espera\n🔄 Recarga em 3 dias\n\nUse \`/perfil\` ou \`/ajuda-vip\` para mais.`); } catch { /* ignora */ }
      await respond(cmd, `🎉 Sorteado: <@${sorteado.id}> ganhou 30 dias de VIP!`);
      return;
    }
    if (sub === "lista") {
      const vips = listarVips();
      if (vips.length === 0) { await respond(cmd, "📋 Nenhum VIP ativo.", { ephemeral: true }); return; }
      const lista = vips.map((v) => `<@${v.user_id}> · ${v.vip_infinito ? "♾️ infinito" : `até ${fmtData(v.vip_ate!)}`}`).join("\n");
      await respond(cmd, `## 👑 VIPs ativos\n\n${lista}`, { ephemeral: true });
      return;
    }
  }

  // ── troll ──
  if (group === "troll") {
    if (sub === "aplicar") {
      const id = cmd.options.getString("id", true);
      const efeito = cmd.options.getString("efeito", true) as TrollEfeito;
      const apelido = cmd.options.getString("apelido");
      ensureUser(id);
      setTrollEfeito(id, efeito, apelido ?? undefined);
      await respond(cmd, `🤡 Trollagem **${efeito}** aplicada em <@${id}>.${apelido ? ` Apelido: "${apelido}"` : ""}`, { ephemeral: true });
      return;
    }
    if (sub === "limpar") {
      const id = cmd.options.getString("id", true);
      setTrollEfeito(id, null);
      await respond(cmd, `✅ Trollagem removida de <@${id}>.`, { ephemeral: true });
      return;
    }
    if (sub === "lista") {
      const lista = listarTrolls();
      if (lista.length === 0) { await respond(cmd, "📋 Ninguém sendo trollado.", { ephemeral: true }); return; }
      const txt = lista.map((t) => `<@${t.user_id}> · \`${t.troll_efeito}\`${t.troll_apelido ? ` (${t.troll_apelido})` : ""}`).join("\n");
      await respond(cmd, `## 🤡 Trollados ativos\n\n${txt}`, { ephemeral: true });
      return;
    }
  }

  // ── servidor ──
  if (group === "servidor") {
    if (sub === "bloquear") {
      const id = cmd.options.getString("id", true);
      setBloqueado(id, true);
      await respond(cmd, `🚫 Servidor \`${id}\` bloqueado.`, { ephemeral: true });
      return;
    }
    if (sub === "desbloquear") {
      const id = cmd.options.getString("id", true);
      setBloqueado(id, false);
      await respond(cmd, `✅ Servidor \`${id}\` desbloqueado.`, { ephemeral: true });
      return;
    }
    if (sub === "limite") {
      const id = cmd.options.getString("id", true);
      const num = cmd.options.getInteger("numero", true);
      setServerLimite(id, num);
      await respond(cmd, `✅ Limite diário do servidor \`${id}\` = **${num}**.`, { ephemeral: true });
      return;
    }
    if (sub === "lista") {
      const lista = listarServidores();
      const guilds = cmd.client.guilds.cache;
      if (lista.length === 0 && guilds.size === 0) { await respond(cmd, "📋 Nenhum servidor.", { ephemeral: true }); return; }
      const linhas: string[] = [];
      for (const g of guilds.values()) {
        const info = lista.find((l) => l.guild_id === g.id);
        linhas.push(`**${g.name}** (\`${g.id}\`)\n  👥 ${g.memberCount} membros · 📥 ${info?.downloads_total ?? 0} downloads`);
      }
      await respond(cmd, `## 🏠 Servidores (${guilds.size})\n\n${linhas.join("\n")}`, { ephemeral: true });
      return;
    }
  }

  // ── bloqueio ──
  if (group === "bloqueio") {
    if (sub === "criador" || sub === "video") {
      const link = cmd.options.getString("link", true);
      const escopoOpt = cmd.options.getString("escopo");
      const escopo = !escopoOpt || escopoOpt === "global" ? "global" : `usuario:${escopoOpt}`;
      const id = adicionarBloqueio(sub === "criador" ? "criador" : "video", link, escopo, userId);
      registrarAcao(userId, "owner", null, `bloqueio:${sub}`, { id });
      await respond(cmd, `🚫 ${sub === "criador" ? "Criador" : "Vídeo"} bloqueado (escopo: ${escopo}).`, { ephemeral: true });
      return;
    }
    if (sub === "desbloquear-criador" || sub === "desbloquear-video") {
      const tipo = sub === "desbloquear-criador" ? "criador" : "video";
      const link = cmd.options.getString("link", true);
      const escopoOpt = cmd.options.getString("escopo");
      const escopo = !escopoOpt || escopoOpt === "global" ? "global" : `usuario:${escopoOpt}`;
      const existing = db.prepare(`SELECT * FROM bloqueios WHERE tipo = ? AND LOWER(identificador) = ? AND escopo = ?`)
        .get(tipo, link.toLowerCase(), escopo) as any;
      const ok = removerBloqueio(tipo, link, escopo);
      if (ok && existing) registrarAcao(userId, "owner", null, `desbloqueio:${tipo}`, existing);
      await respond(cmd, ok ? "✅ Bloqueio removido." : "ℹ️ Não havia esse bloqueio.", { ephemeral: true });
      return;
    }
    if (sub === "lista") {
      const lista = listarBloqueios();
      if (lista.length === 0) { await respond(cmd, "📋 Nenhum bloqueio.", { ephemeral: true }); return; }
      const txt = lista.slice(0, 30).map((b) => `\`${b.tipo}\` · ${b.identificador} · escopo: ${b.escopo}`).join("\n");
      await respond(cmd, `## 🚫 Bloqueios (${lista.length})\n\n${txt}`, { ephemeral: true });
      return;
    }
  }

  // ── evento ──
  if (group === "evento") {
    if (sub === "ativar") {
      const nome = cmd.options.getString("nome", true);
      const horas = cmd.options.getInteger("horas") ?? 24;
      const evento = CATALOGO_EVENTOS[nome];
      if (!evento) { await respond(cmd, "❌ Evento desconhecido.", { ephemeral: true }); return; }
      const inicio = Date.now();
      const fim = inicio + horas * 60 * 60 * 1000;
      criarEventoManual(evento.nome, inicio, fim, evento);
      await respond(cmd, `${evento.emoji} Evento **${evento.nome}** ativado por ${horas}h!\n${evento.mensagem}`, { ephemeral: true });
      return;
    }
    if (sub === "lista") {
      const lista = listarEventosManuais();
      if (lista.length === 0) { await respond(cmd, "📋 Nenhum evento manual.", { ephemeral: true }); return; }
      const txt = lista.map((e) => `**${e.nome}** · de ${fmtData(e.inicio)} até ${fmtData(e.fim)}`).join("\n");
      await respond(cmd, `## 🎉 Eventos manuais\n\n${txt}`, { ephemeral: true });
      return;
    }
    if (sub === "desligar") {
      const n = desligarEventosManuais();
      await respond(cmd, `✅ ${n} evento(s) manual(is) desligado(s).`, { ephemeral: true });
      return;
    }
  }

  // ── sistema ──
  if (group === "sistema") {
    if (sub === "desfazer") {
      await desfazerHandler(cmd, "owner", userId);
      return;
    }
    if (sub === "historico") {
      const acoes = historicoAcoes(userId, "owner", 10);
      if (acoes.length === 0) { await respond(cmd, "ℹ️ Sem histórico de ações.", { ephemeral: true }); return; }
      const txt = acoes.map((a) => `\`${a.acao}\` · ${fmtData(a.executada_em)}${a.desfeita ? " ↩️" : ""}`).join("\n");
      await respond(cmd, `## 📜 Suas últimas 10 ações\n\n${txt}`, { ephemeral: true });
      return;
    }
    if (sub === "banidos-lista") {
      const lista = db.prepare(`SELECT user_id, motivo_ban FROM users WHERE banido_global = 1`).all() as any[];
      if (lista.length === 0) { await respond(cmd, "📋 Nenhum banido global.", { ephemeral: true }); return; }
      const txt = lista.map((b) => `<@${b.user_id}>${b.motivo_ban ? ` — ${b.motivo_ban}` : ""}`).join("\n");
      await respond(cmd, `## 🚫 Banidos globais\n\n${txt}`, { ephemeral: true });
      return;
    }
  }
}

// ─── Bot wiring ──────────────────────────────────────────────

export function startBot() {
  if (!token) return;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Bot online!");
    const appClientId = clientId || readyClient.user.id;
    await registerCommands(token!, appClientId);

    // Anuncia eventos automáticos do dia (uma vez)
    const eventos = eventosAtivos();
    if (eventos.length > 0) {
      logger.info({ eventos: eventos.map((e) => e.nome) }, "Eventos ativos hoje");
    }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      // Ignora bots e DMs (itens 25, 26)
      if (interaction.user.bot) return;

      // Slash commands
      if (interaction.isChatInputCommand()) {
        const cmd = interaction;

        // Comandos owner-only nem chegam no gate normal — verificação especial
        if (cmd.commandName === "owner" || cmd.commandName === "ajuda-owner") {
          if (!isBotAdmin(cmd.user.id)) {
            // ignora completamente (item 275/632)
            try { await cmd.reply({ content: "❌ Comando não disponível.", flags: EPHEMERAL }); } catch { /* ignora */ }
            return;
          }
        }

        // Gate geral
        const gate = await gateGeral(cmd);
        if (!gate.ok) {
          if (gate.motivo === "bot") return;
          try { await cmd.reply({ content: gate.motivo!, flags: EPHEMERAL }); } catch { /* ignora */ }
          return;
        }

        // Anti-spam (não aplicar para comandos administrativos leves)
        const exemptos = new Set(["fichas", "perfil", "historico", "ajuda", "ajuda-adm", "ajuda-owner", "adm", "owner"]);
        if (!exemptos.has(cmd.commandName)) {
          const spam = gateAntiSpam(cmd.user.id);
          if (!spam.ok) {
            try { await cmd.reply({ content: spam.motivo!, flags: EPHEMERAL }); } catch { /* ignora */ }
            return;
          }
        }

        // Trollagem: lento (atraso 30s)
        const { efeito } = getTrollEfeito(cmd.user.id);
        if (efeito === "lento") {
          await new Promise((r) => setTimeout(r, 30000));
        }
        if (efeito === "contagem") {
          try {
            await cmd.reply({ content: "5...", flags: EPHEMERAL });
            for (const n of [4, 3, 2, 1]) {
              await new Promise((r) => setTimeout(r, 1000));
              try { await cmd.editReply({ content: `${n}...` }); } catch { /* ignora */ }
            }
            await new Promise((r) => setTimeout(r, 1000));
          } catch { /* ignora */ }
        }
        if (efeito === "eco") {
          try { await cmd.reply({ content: `📣 Você disse: \`/${cmd.commandName}\``, flags: EPHEMERAL }); } catch { /* ignora */ }
        }

        // Roteamento
        switch (cmd.commandName) {
          case "video": await handleVideo(cmd); return;
          case "prever": {
            const url = cmd.options.getString("link", true);
            const v = validarLink(url);
            if (!v.ok) { await respond(cmd, mensagemErroLink(v.erro), { ephemeral: true }); return; }
            await cmd.deferReply();
            try {
              const r = await preverViral(v.url);
              const embed = buildPrevisaoEmbed(r);
              await cmd.editReply({ embeds: [embed] });
            } catch (err) {
              logger.error({ err }, "Erro em /prever");
              await respond(cmd, classificarErroDownload(err));
            }
            return;
          }
          case "trending": {
            const plataforma = cmd.options.getString("plataforma", true);
            const categoria = cmd.options.getString("categoria") || "";
            const tema = cmd.options.getString("tema") || "";
            await cmd.deferReply();
            try {
              const result = await analyzeTrending(plataforma, categoria, tema);
              const embed = buildTrendingEmbed(result, 0);
              const reply = await cmd.editReply({ embeds: [embed] });
              const messageId = reply.id;
              trendingCache.set(messageId, { result, page: 0 });
              setTimeout(() => trendingCache.delete(messageId), 30 * 60 * 1000);
              const row = buildTrendingButtons(0, result.itens.length, messageId);
              await cmd.editReply({ embeds: [embed], components: [row] });
            } catch (err) {
              logger.error({ err }, "Erro em /trending");
              await respond(cmd, "❌ Não consegui buscar as tendências agora.");
            }
            return;
          }
          case "fichas": await handleFichas(cmd); return;
          case "perfil": await handlePerfil(cmd); return;
          case "historico": await handleHistorico(cmd); return;
          case "top": await handleTop(cmd); return;
          case "ranking": await handleRanking(cmd); return;
          case "ajuda": await handleAjuda(cmd, buildAjudaUsuario()); return;
          case "ajuda-adm":
            if (!isServerAdmin(cmd) && !isBotAdmin(cmd.user.id)) {
              await respond(cmd, "❌ Você não tem permissão.", { ephemeral: true }); return;
            }
            await handleAjuda(cmd, buildAjudaAdm()); return;
          case "ajuda-owner": await handleAjuda(cmd, buildAjudaOwner()); return;
          case "adm": await handleAdm(cmd); return;
          case "owner": await handleOwner(cmd); return;
        }
      }

      // Buttons
      if (interaction.isButton()) {
        const btn = interaction;
        const customId = btn.customId;

        // /trending paginação
        if (customId.startsWith("trending_")) {
          const parts = customId.split("_");
          const action = parts[1];
          const messageId = parts[2];
          const cached = trendingCache.get(messageId);
          if (!cached) {
            await btn.reply({ content: "⏳ Esta pesquisa expirou.", flags: EPHEMERAL });
            return;
          }
          if (action === "page") return;
          let newPage = cached.page;
          if (action === "prev") newPage = Math.max(0, newPage - 1);
          if (action === "next") newPage = Math.min(cached.result.itens.length - 1, newPage + 1);
          cached.page = newPage;
          trendingCache.set(messageId, cached);
          const embed = buildTrendingEmbed(cached.result, newPage);
          const row = buildTrendingButtons(newPage, cached.result.itens.length, messageId);
          await btn.update({ embeds: [embed], components: [row] });
          return;
        }

        // /ajuda paginação
        if (customId.startsWith("ajuda_")) {
          const parts = customId.split("_");
          const action = parts[1];
          const id = parts[2];
          const cached = ajudaPages.get(id);
          if (!cached) {
            await btn.reply({ content: "⏳ Ajuda expirou.", flags: EPHEMERAL });
            return;
          }
          let newP = cached.pagina;
          if (action === "prev") newP = Math.max(0, newP - 1);
          if (action === "next") newP = Math.min(cached.paginas.length - 1, newP + 1);
          cached.pagina = newP;
          ajudaPages.set(id, cached);
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`ajuda_prev_${id}`).setLabel("⬅️ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(newP === 0),
            new ButtonBuilder().setCustomId(`ajuda_next_${id}`).setLabel("Próxima ➡️").setStyle(ButtonStyle.Secondary).setDisabled(newP === cached.paginas.length - 1)
          );
          await btn.update({ embeds: [cached.paginas[newP]], components: [row] });
          return;
        }

        // /video confirmação
        if (customId.startsWith("dl_yes_")) {
          await handleDownloadConfirm(btn, customId.slice("dl_yes_".length));
          return;
        }
        if (customId.startsWith("dl_no_")) {
          await handleDownloadCancel(btn, customId.slice("dl_no_".length));
          return;
        }
      }
    } catch (err) {
      logger.error({ err }, "Erro não tratado em interação");
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Falha ao fazer login no Discord");
  });

  return client;
}
