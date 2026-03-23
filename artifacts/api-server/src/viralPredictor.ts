import { execFile } from "child_process";
import { promisify } from "util";
import OpenAI from "openai";
import { logger } from "./lib/logger";

const execFileAsync = promisify(execFile);

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface PrevisaoResult {
  tipo: "video" | "canal" | "live";
  titulo: string;
  canal: string;
  plataforma: string;
  views: number;
  inscritos?: number;
  concurrentViewers?: number;
  videosRecentes?: string[];
  veredicto: "VAI BOMBAR" | "NÃO VAI BOMBAR";
  confianca: number;
  motivo: string;
  pontosFavoraveis: string[];
  pontosContra: string[];
  dicaMelhora: string;
  sugestoesTitulos: string[];
  sugestoesTags: string[];
  dicaThumbnail: string;
}

function isChannelUrl(url: string): boolean {
  if (
    (url.includes("youtube.com/@") ||
      url.includes("youtube.com/channel/") ||
      url.includes("youtube.com/c/") ||
      url.includes("youtube.com/user/")) &&
    !url.includes("/watch") &&
    !url.includes("/shorts/") &&
    !url.includes("/live")
  ) return true;
  if (url.includes("tiktok.com/@") && !url.includes("/video/")) return true;
  if (
    url.includes("instagram.com/") &&
    !url.includes("/p/") &&
    !url.includes("/reel/") &&
    !url.includes("/tv/")
  ) return true;
  return false;
}

function detectPlatform(url: string): string {
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    if (url.includes("/shorts/")) return "YouTube Shorts";
    return "YouTube";
  }
  if (url.includes("tiktok.com")) return "TikTok";
  if (url.includes("instagram.com")) return "Instagram";
  return "Vídeo";
}

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n > 0 ? String(n) : "N/D";
}

// ─── Busca metadados de vídeo/live ──────────────────────────

async function getVideoMeta(url: string) {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--print",
    "%(title)s\n%(channel)s\n%(view_count)s\n%(duration)s\n%(like_count)s\n%(is_live)s\n%(concurrent_view_count)s\n%(channel_follower_count)s",
    "--no-download",
    "--extractor-args", "youtube:player_client=ios",
    "--no-warnings",
    url,
  ], { timeout: 30000 });

  const lines = stdout.trim().split("\n");
  const isLive = lines[5]?.trim() === "True";
  const concurrentViewers = parseInt(lines[6]) || 0;
  const channelSubs = parseInt(lines[7]) || 0;

  return {
    title: lines[0] || "Sem título",
    channel: lines[1] || "Desconhecido",
    views: parseInt(lines[2]) || 0,
    duration: parseFloat(lines[3]) || 0,
    likeCount: parseInt(lines[4]) || 0,
    isLive,
    concurrentViewers,
    channelSubs,
    platform: detectPlatform(url),
  };
}

// ─── Busca metadados de canal ────────────────────────────────

async function getChannelMeta(url: string) {
  const { stdout: infoOut } = await execFileAsync("yt-dlp", [
    "--print", "%(channel)s\n%(channel_follower_count)s",
    "--playlist-items", "1",
    "--no-warnings",
    "--extractor-args", "youtube:player_client=ios",
    url,
  ], { timeout: 30000 });

  const infoLines = infoOut.trim().split("\n");
  const channelName = infoLines[0] || "Desconhecido";
  const subscribers = parseInt(infoLines[1]) || 0;

  let recentVideos: string[] = [];
  let totalViewsRecentes = 0;
  try {
    const { stdout: videosOut } = await execFileAsync("yt-dlp", [
      "--flat-playlist",
      "--print", "%(title)s|||%(view_count)s",
      "--playlist-items", "1-5",
      "--no-warnings",
      "--extractor-args", "youtube:player_client=ios",
      url,
    ], { timeout: 30000 });

    const videoLines = videosOut.trim().split("\n").filter(Boolean);
    for (const line of videoLines) {
      const parts = line.split("|||");
      if (parts.length < 2) continue;
      const [title, viewsStr] = parts;
      const v = parseInt(viewsStr) || 0;
      totalViewsRecentes += v;
      recentVideos.push(`"${title.trim()}" (${fmtNum(v)} views)`);
    }
  } catch { /* ignora */ }

  const mediaViews = recentVideos.length > 0
    ? Math.round(totalViewsRecentes / recentVideos.length)
    : 0;

  return { channelName, subscribers, recentVideos, mediaViews, platform: detectPlatform(url) };
}

// ─── Geração da previsão via IA ──────────────────────────────

async function gerarPrevisao(contexto: string, nicho: string, isShorts = false): Promise<{
  veredicto: "VAI BOMBAR" | "NÃO VAI BOMBAR";
  confianca: number;
  motivo: string;
  pontosFavoraveis: string[];
  pontosContra: string[];
  dicaMelhora: string;
  sugestoesTitulos: string[];
  sugestoesTags: string[];
  dicaThumbnail: string;
}> {
  const prompt = `Você é o VIGILANTE, sistema de análise de viralidade para criadores de conteúdo. Você é inteligente e realista — sabe que um canal com muitos inscritos tem credibilidade, que uma live com muitos espectadores simultâneos é um sinal MUITO positivo, e que views altos sempre indicam potencial.

${contexto}

Responda APENAS com JSON válido (sem markdown, sem explicação):

{
  "veredicto": "VAI BOMBAR",
  "confianca": 72,
  "motivo": "Explicação objetiva de 2 frases sobre o potencial",
  "pontosFavoraveis": ["ponto concreto 1", "ponto concreto 2", "ponto concreto 3"],
  "pontosContra": ["ponto concreto 1", "ponto concreto 2"],
  "dicaMelhora": "Dica concreta e específica para aumentar as chances",
  "sugestoesTitulos": [
    "Título sugerido 1 (chamativo e otimizado)",
    "Título sugerido 2",
    "Título sugerido 3"
  ],
  "sugestoesTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "dicaThumbnail": "dica aqui"
}

Regras OBRIGATÓRIAS:
- veredicto: "VAI BOMBAR" ou "NÃO VAI BOMBAR"
- confianca: NUNCA pode ser 100, NUNCA pode ser 0. Máximo 89, mínimo 11
- Live com 4K+ espectadores simultâneos = sinal MUITO positivo → tende a VAI BOMBAR
- Canal com muitos inscritos = credibilidade já estabelecida → ponto favorável
- Views muito acima da média do nicho = sinal forte de viralidade
- pontosFavoraveis: 2 a 4 pontos, baseados nos DADOS REAIS fornecidos
- pontosContra: 1 a 3 pontos REAIS, não invente problemas que não existem
- sugestoesTitulos: 3 títulos criativos e otimizados para o nicho "${nicho}"
- sugestoesTags: 5 tags relevantes para o nicho
${isShorts
  ? '- dicaThumbnail: coloque EXATAMENTE "SHORTS_SEM_THUMBNAIL" — Shorts não tem thumbnail personalizada'
  : "- dicaThumbnail: dica visual específica e prática para uma thumbnail chamativa"}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 1200,
  });

  const content = response.choices[0]?.message?.content || "";
  const parsed = JSON.parse(content);

  return {
    veredicto: parsed.veredicto,
    confianca: Math.min(89, Math.max(11, Number(parsed.confianca))),
    motivo: parsed.motivo || "",
    pontosFavoraveis: parsed.pontosFavoraveis || [],
    pontosContra: parsed.pontosContra || [],
    dicaMelhora: parsed.dicaMelhora || "",
    sugestoesTitulos: parsed.sugestoesTitulos || [],
    sugestoesTags: parsed.sugestoesTags || [],
    dicaThumbnail: parsed.dicaThumbnail || "",
  };
}

// ─── Prever VÍDEO ou LIVE ────────────────────────────────────

async function preverVideo(url: string): Promise<PrevisaoResult> {
  const meta = await getVideoMeta(url);
  const duracaoStr = `${Math.floor(meta.duration / 60)}:${Math.floor(meta.duration % 60).toString().padStart(2, "0")}`;
  const tipo: "video" | "live" = meta.isLive ? "live" : "video";

  let contexto: string;
  if (meta.isLive) {
    contexto = `Analise esta LIVE ao vivo e preveja se ela tem potencial de explodir:

- Título da live: "${meta.title}"
- Canal: ${meta.channel}
- Inscritos do canal: ${fmtNum(meta.channelSubs)}
- Plataforma: ${meta.platform}
- Espectadores simultâneos AGORA: ${fmtNum(meta.concurrentViewers)}
- Views totais acumulados: ${fmtNum(meta.views)}
- Curtidas: ${meta.likeCount > 0 ? fmtNum(meta.likeCount) : "N/D"}

CONTEXTO IMPORTANTE: ${meta.concurrentViewers >= 1000 ? `${fmtNum(meta.concurrentViewers)} espectadores simultâneos é um número expressivo e indica alto engajamento.` : "A live está em andamento."} ${meta.channelSubs > 10000 ? `O canal já tem ${fmtNum(meta.channelSubs)} inscritos, o que é uma base sólida.` : ""}`;
  } else {
    contexto = `Analise este VÍDEO e preveja se ele tem potencial de BOMBAR:

- Título: "${meta.title}"
- Canal: ${meta.channel}
- Inscritos do canal: ${fmtNum(meta.channelSubs)}
- Plataforma: ${meta.platform}
- Views atuais: ${fmtNum(meta.views)}
- Curtidas: ${meta.likeCount > 0 ? fmtNum(meta.likeCount) : "N/D"}
- Duração: ${duracaoStr}`;
  }

  const nicho = meta.title;
  const isShorts = meta.platform === "YouTube Shorts";
  const ai = await gerarPrevisao(contexto, nicho, isShorts);

  return {
    tipo,
    titulo: meta.title,
    canal: meta.channel,
    plataforma: meta.platform,
    views: meta.views,
    inscritos: meta.channelSubs || undefined,
    concurrentViewers: meta.isLive ? meta.concurrentViewers : undefined,
    veredicto: ai.veredicto,
    confianca: ai.confianca,
    motivo: ai.motivo,
    pontosFavoraveis: ai.pontosFavoraveis,
    pontosContra: ai.pontosContra,
    dicaMelhora: ai.dicaMelhora,
    sugestoesTitulos: ai.sugestoesTitulos,
    sugestoesTags: ai.sugestoesTags,
    dicaThumbnail: ai.dicaThumbnail,
  };
}

// ─── Prever CANAL ────────────────────────────────────────────

async function preverCanal(url: string): Promise<PrevisaoResult> {
  const meta = await getChannelMeta(url);

  const videosStr = meta.recentVideos.length > 0
    ? meta.recentVideos.map((v, i) => `${i + 1}. ${v}`).join("\n")
    : "Sem dados de vídeos recentes";

  const engajamento = meta.subscribers > 0 && meta.mediaViews > 0
    ? ((meta.mediaViews / meta.subscribers) * 100).toFixed(1)
    : null;

  const contexto = `Analise este CANAL e preveja se ele tem potencial de EXPLODIR (crescer muito em inscritos e views):

- Nome do Canal: ${meta.channelName}
- Plataforma: ${meta.platform}
- Inscritos: ${fmtNum(meta.subscribers)}
- Média de views por vídeo: ${fmtNum(meta.mediaViews)}${engajamento ? `\n- Taxa de engajamento (views/inscritos): ${engajamento}%` : ""}
- Vídeos recentes:
${videosStr}

CONTEXTO IMPORTANTE: ${meta.subscribers > 100000 ? `Canal com ${fmtNum(meta.subscribers)} inscritos já tem credibilidade estabelecida.` : ""} ${meta.mediaViews > meta.subscribers ? "A média de views SUPERA os inscritos — sinal MUITO POSITIVO de viralidade." : ""}`;

  const ai = await gerarPrevisao(contexto, meta.channelName);

  return {
    tipo: "canal",
    titulo: meta.channelName,
    canal: meta.channelName,
    plataforma: meta.platform,
    views: meta.mediaViews,
    inscritos: meta.subscribers,
    videosRecentes: meta.recentVideos,
    veredicto: ai.veredicto,
    confianca: ai.confianca,
    motivo: ai.motivo,
    pontosFavoraveis: ai.pontosFavoraveis,
    pontosContra: ai.pontosContra,
    dicaMelhora: ai.dicaMelhora,
    sugestoesTitulos: ai.sugestoesTitulos,
    sugestoesTags: ai.sugestoesTags,
    dicaThumbnail: ai.dicaThumbnail,
  };
}

// ─── Exportado ───────────────────────────────────────────────

export async function preverViral(url: string): Promise<PrevisaoResult> {
  try {
    if (isChannelUrl(url)) return await preverCanal(url);
    return await preverVideo(url);
  } catch (err) {
    logger.error({ err }, "Erro na previsão");
    throw new Error("Não consegui analisar este link. Verifique se é um vídeo, live ou canal válido.");
  }
}
