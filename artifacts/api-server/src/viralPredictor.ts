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
  tipo: "video" | "canal";
  titulo: string;
  canal: string;
  plataforma: string;
  views: number;
  inscritos?: number;
  videosRecentes?: string[];
  veredicto: "VAI BOMBAR" | "NÃO VAI BOMBAR";
  confianca: number;
  motivo: string;
  pontosFavoraveis: string[];
  pontosContra: string[];
  dicaMelhora: string;
}

// ─── Detecta se é canal ou vídeo ────────────────────────────

function isChannelUrl(url: string): boolean {
  // YouTube: /@handle, /channel/, /c/, /user/
  if (
    url.includes("youtube.com/@") ||
    url.includes("youtube.com/channel/") ||
    url.includes("youtube.com/c/") ||
    url.includes("youtube.com/user/")
  ) {
    // Garante que não é um vídeo
    if (!url.includes("/watch") && !url.includes("/shorts/")) return true;
  }
  // TikTok: /@username sem /video/
  if (url.includes("tiktok.com/@") && !url.includes("/video/")) return true;
  // Instagram: perfil (sem /p/ nem /reel/)
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
    return url.includes("/shorts/") ? "YouTube Shorts" : "YouTube";
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

// ─── Busca metadados de VÍDEO ────────────────────────────────

async function getVideoMeta(url: string) {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--print", "%(title)s\n%(channel)s\n%(view_count)s\n%(duration)s\n%(like_count)s",
    "--no-download",
    "--extractor-args", "youtube:player_client=ios",
    "--no-warnings",
    url,
  ], { timeout: 30000 });

  const lines = stdout.trim().split("\n");
  return {
    title: lines[0] || "Sem título",
    channel: lines[1] || "Desconhecido",
    views: parseInt(lines[2]) || 0,
    duration: parseFloat(lines[3]) || 0,
    likeCount: parseInt(lines[4]) || 0,
    platform: detectPlatform(url),
  };
}

// ─── Busca metadados de CANAL ────────────────────────────────

async function getChannelMeta(url: string) {
  // Pega info do canal + até 5 vídeos recentes
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

  // Pega os 5 vídeos mais recentes com views
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
  } catch {
    // ignora erro nos vídeos recentes
  }

  const mediaViews = recentVideos.length > 0 ? Math.round(totalViewsRecentes / recentVideos.length) : 0;

  return {
    channelName,
    subscribers,
    recentVideos,
    mediaViews,
    platform: detectPlatform(url),
  };
}

// ─── Previsão de VÍDEO ───────────────────────────────────────

async function preverVideo(url: string): Promise<PrevisaoResult> {
  const meta = await getVideoMeta(url);
  const duracaoStr = `${Math.floor(meta.duration / 60)}:${Math.floor(meta.duration % 60).toString().padStart(2, "0")}`;

  const prompt = `Você é o VIGILANTE, sistema de análise de viralidade para criadores de conteúdo.

Analise este VÍDEO e preveja se ele tem potencial de BOMBAR:

- Título: "${meta.title}"
- Canal: ${meta.channel}
- Plataforma: ${meta.platform}
- Views: ${fmtNum(meta.views)}
- Curtidas: ${meta.likeCount > 0 ? fmtNum(meta.likeCount) : "N/D"}
- Duração: ${duracaoStr}

Responda APENAS com JSON válido (sem markdown):

{
  "veredicto": "VAI BOMBAR",
  "confianca": 72,
  "motivo": "Explicação curta e direta (máx 2 frases)",
  "pontosFavoraveis": ["ponto 1", "ponto 2", "ponto 3"],
  "pontosContra": ["ponto 1", "ponto 2"],
  "dicaMelhora": "Uma dica concreta para aumentar as chances de viralizar"
}

Regras:
- veredicto: "VAI BOMBAR" ou "NÃO VAI BOMBAR"
- confianca: 10 a 90 (NUNCA 100, NUNCA 0)
- pontosFavoraveis: 2 a 4 pontos reais
- pontosContra: 1 a 3 pontos reais`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 800,
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");

  return {
    tipo: "video",
    titulo: meta.title,
    canal: meta.channel,
    plataforma: meta.platform,
    views: meta.views,
    veredicto: parsed.veredicto,
    confianca: Math.min(90, Math.max(10, parsed.confianca)),
    motivo: parsed.motivo,
    pontosFavoraveis: parsed.pontosFavoraveis || [],
    pontosContra: parsed.pontosContra || [],
    dicaMelhora: parsed.dicaMelhora || "",
  };
}

// ─── Previsão de CANAL ───────────────────────────────────────

async function preverCanal(url: string): Promise<PrevisaoResult> {
  const meta = await getChannelMeta(url);

  const videosStr = meta.recentVideos.length > 0
    ? meta.recentVideos.map((v, i) => `${i + 1}. ${v}`).join("\n")
    : "Sem dados de vídeos recentes";

  const prompt = `Você é o VIGILANTE, sistema de análise de viralidade para criadores de conteúdo.

Analise este CANAL e preveja se ele tem potencial de BOMBAR (explodir em inscritos e views):

- Nome do Canal: ${meta.channelName}
- Plataforma: ${meta.platform}
- Inscritos: ${fmtNum(meta.subscribers)}
- Média de views nos vídeos recentes: ${fmtNum(meta.mediaViews)}
- Vídeos recentes:
${videosStr}

Responda APENAS com JSON válido (sem markdown):

{
  "veredicto": "VAI BOMBAR",
  "confianca": 68,
  "motivo": "Explicação curta e direta sobre o potencial do canal (máx 2 frases)",
  "pontosFavoraveis": ["ponto 1", "ponto 2", "ponto 3"],
  "pontosContra": ["ponto 1", "ponto 2"],
  "dicaMelhora": "Uma dica concreta para o canal crescer mais rápido"
}

Regras:
- veredicto: "VAI BOMBAR" ou "NÃO VAI BOMBAR"
- confianca: 10 a 90 (NUNCA 100, NUNCA 0)
- Analise consistência dos vídeos, média de views vs inscritos, frequência
- Se média de views supera inscritos, é sinal muito positivo
- pontosFavoraveis: 2 a 4 pontos reais sobre o canal
- pontosContra: 1 a 3 pontos reais`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 800,
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");

  return {
    tipo: "canal",
    titulo: meta.channelName,
    canal: meta.channelName,
    plataforma: meta.platform,
    views: meta.mediaViews,
    inscritos: meta.subscribers,
    videosRecentes: meta.recentVideos,
    veredicto: parsed.veredicto,
    confianca: Math.min(90, Math.max(10, parsed.confianca)),
    motivo: parsed.motivo,
    pontosFavoraveis: parsed.pontosFavoraveis || [],
    pontosContra: parsed.pontosContra || [],
    dicaMelhora: parsed.dicaMelhora || "",
  };
}

// ─── Exportado ───────────────────────────────────────────────

export async function preverViral(url: string): Promise<PrevisaoResult> {
  try {
    if (isChannelUrl(url)) {
      return await preverCanal(url);
    }
    return await preverVideo(url);
  } catch (err) {
    logger.error({ err }, "Erro na previsão");
    throw new Error("Não consegui analisar este link. Verifique se é um vídeo ou canal válido.");
  }
}
