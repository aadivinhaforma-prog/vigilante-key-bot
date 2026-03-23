import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
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
  totalVideos?: number;
  videosRecentes?: string[];
  comentariosDestaque?: string[];
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

// ─── Detecção de tipo de URL ─────────────────────────────────

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

// ─── Busca comentários reais com yt-dlp ──────────────────────

async function getComments(url: string): Promise<string[]> {
  const tmpDir = os.tmpdir();
  const tmpId = `vigilante_${Date.now()}`;
  const outputTemplate = path.join(tmpDir, tmpId);
  const infoFile = `${outputTemplate}.info.json`;

  try {
    await execFileAsync("yt-dlp", [
      "--write-comments",
      "--no-download",
      "--extractor-args", "youtube:player_client=ios",
      "--no-warnings",
      "-o", outputTemplate,
      url,
    ], { timeout: 90000 });

    if (!fs.existsSync(infoFile)) return [];

    const raw = fs.readFileSync(infoFile, "utf-8");
    const data = JSON.parse(raw);
    const comments: Array<{ text: string; like_count?: number }> = data.comments || [];

    // Limpa arquivo temporário
    try { fs.unlinkSync(infoFile); } catch { /* ignora */ }

    // Ordena por likes e retorna os top 25
    return comments
      .filter((c) => c.text && c.text.trim().length > 5)
      .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
      .slice(0, 25)
      .map((c) => c.text.trim());
  } catch (err) {
    logger.warn({ err }, "Não foi possível buscar comentários");
    // Limpa arquivo se existir
    try { if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile); } catch { /* ignora */ }
    return [];
  }
}

// ─── Busca metadados de vídeo/live ──────────────────────────

async function getVideoMeta(url: string) {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--print",
    "%(title)s\n%(channel)s\n%(view_count)s\n%(duration)s\n%(like_count)s\n%(is_live)s\n%(concurrent_view_count)s\n%(channel_follower_count)s\n%(comment_count)s",
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
    isLive: lines[5]?.trim() === "True",
    concurrentViewers: parseInt(lines[6]) || 0,
    channelSubs: parseInt(lines[7]) || 0,
    commentCount: parseInt(lines[8]) || 0,
    platform: detectPlatform(url),
  };
}

// ─── Busca TODOS os vídeos do canal ─────────────────────────

async function getChannelMeta(url: string) {
  // Info básica do canal
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

  // Busca TODOS os vídeos (sem limite de playlist)
  let allVideos: string[] = [];
  let totalViews = 0;
  let totalVideos = 0;

  try {
    const { stdout: videosOut } = await execFileAsync("yt-dlp", [
      "--flat-playlist",
      "--print", "%(title)s|||%(view_count)s",
      "--no-warnings",
      "--extractor-args", "youtube:player_client=ios",
      url,
    ], { timeout: 180000 }); // 3 minutos para canais grandes

    const videoLines = videosOut.trim().split("\n").filter(Boolean);
    totalVideos = videoLines.length;

    const parsed = videoLines.map((line) => {
      const parts = line.split("|||");
      const title = parts[0]?.trim() || "";
      const views = parseInt(parts[1]) || 0;
      return { title, views };
    }).filter((v) => v.title);

    // Ordena por views para encontrar os mais bombados
    parsed.sort((a, b) => b.views - a.views);

    totalViews = parsed.reduce((sum, v) => sum + v.views, 0);
    const mediaViews = totalVideos > 0 ? Math.round(totalViews / totalVideos) : 0;

    // Mostra top 10 mais vistos de todos os tempos
    allVideos = parsed.slice(0, 10).map(
      (v, i) => `${i + 1}. "${v.title}" — ${fmtNum(v.views)} views`
    );

    const mediaViewsStr = fmtNum(mediaViews);

    return {
      channelName,
      subscribers,
      allVideos,
      totalVideos,
      mediaViews,
      mediaViewsStr,
      platform: detectPlatform(url),
    };
  } catch (err) {
    logger.warn({ err }, "Erro ao buscar todos os vídeos do canal");
    return {
      channelName,
      subscribers,
      allVideos: [],
      totalVideos: 0,
      mediaViews: 0,
      mediaViewsStr: "N/D",
      platform: detectPlatform(url),
    };
  }
}

// ─── IA gera a previsão ──────────────────────────────────────

async function gerarPrevisao(
  contexto: string,
  nicho: string,
  isShorts = false
): Promise<{
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
  const thumbRule = isShorts
    ? '- dicaThumbnail: coloque EXATAMENTE "SHORTS_SEM_THUMBNAIL" pois Shorts não tem thumbnail personalizada'
    : "- dicaThumbnail: dica visual específica e prática para uma thumbnail chamativa";

  const prompt = `Você é o VIGILANTE, sistema de análise de viralidade para criadores de conteúdo. Você é inteligente e realista — sabe avaliar o potencial real de um conteúdo.

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
    "Título sugerido 1 (chamativo e otimizado para o nicho)",
    "Título sugerido 2",
    "Título sugerido 3"
  ],
  "sugestoesTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "dicaThumbnail": "dica aqui"
}

Regras OBRIGATÓRIAS:
- veredicto: "VAI BOMBAR" ou "NÃO VAI BOMBAR"
- confianca: NUNCA pode ser 100, NUNCA pode ser 0. Máximo 89, mínimo 11
- Live com 4K+ espectadores simultâneos = sinal MUITO positivo → VAI BOMBAR
- Canal com muitos inscritos = credibilidade estabelecida → ponto favorável
- Se comentários mostram reações positivas/hype = sinal positivo
- Se comentários mostram reclamações = anote como ponto contra
- Views muito acima da média do nicho = sinal forte de viralidade
- pontosFavoraveis: 2 a 4 pontos baseados nos DADOS REAIS
- pontosContra: 1 a 3 pontos REAIS, não invente problemas
- sugestoesTitulos: 3 títulos criativos para o nicho "${nicho}"
- sugestoesTags: 5 tags relevantes para o nicho
${thumbRule}`;

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

// ─── Prever VÍDEO / LIVE ─────────────────────────────────────

async function preverVideo(url: string): Promise<PrevisaoResult> {
  // Busca metadados e comentários em paralelo
  const [meta, comentarios] = await Promise.all([
    getVideoMeta(url),
    getComments(url),
  ]);

  const duracaoStr = `${Math.floor(meta.duration / 60)}:${Math.floor(meta.duration % 60).toString().padStart(2, "0")}`;
  const tipo: "video" | "live" = meta.isLive ? "live" : "video";
  const isShorts = meta.platform === "YouTube Shorts";

  const comentariosStr = comentarios.length > 0
    ? `\n\nComentários mais curtidos (${comentarios.length} analisados):\n${comentarios.slice(0, 10).map((c, i) => `${i + 1}. "${c}"`).join("\n")}`
    : "\n\nComentários: não disponíveis ou sem comentários.";

  let contexto: string;
  if (meta.isLive) {
    contexto = `Analise esta LIVE ao vivo:

- Título: "${meta.title}"
- Canal: ${meta.channel}
- Inscritos do canal: ${fmtNum(meta.channelSubs)}
- Plataforma: ${meta.platform}
- Espectadores simultâneos AGORA: ${fmtNum(meta.concurrentViewers)}
- Views totais acumulados: ${fmtNum(meta.views)}
- Curtidas: ${meta.likeCount > 0 ? fmtNum(meta.likeCount) : "N/D"}
- Total de comentários: ${meta.commentCount > 0 ? fmtNum(meta.commentCount) : "N/D"}
${comentariosStr}

IMPORTANTE: ${meta.concurrentViewers >= 1000 ? `${fmtNum(meta.concurrentViewers)} espectadores simultâneos é expressivo e indica alto engajamento.` : ""} ${meta.channelSubs > 10000 ? `O canal tem ${fmtNum(meta.channelSubs)} inscritos — base sólida.` : ""}`;
  } else {
    contexto = `Analise este ${isShorts ? "SHORTS" : "VÍDEO"}:

- Título: "${meta.title}"
- Canal: ${meta.channel}
- Inscritos do canal: ${fmtNum(meta.channelSubs)}
- Plataforma: ${meta.platform}
- Views: ${fmtNum(meta.views)}
- Curtidas: ${meta.likeCount > 0 ? fmtNum(meta.likeCount) : "N/D"}
- Total de comentários: ${meta.commentCount > 0 ? fmtNum(meta.commentCount) : "N/D"}
- Duração: ${duracaoStr}
${comentariosStr}`;
  }

  const ai = await gerarPrevisao(contexto, meta.title, isShorts);

  return {
    tipo,
    titulo: meta.title,
    canal: meta.channel,
    plataforma: meta.platform,
    views: meta.views,
    inscritos: meta.channelSubs || undefined,
    concurrentViewers: meta.isLive ? meta.concurrentViewers : undefined,
    comentariosDestaque: comentarios.slice(0, 5),
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

  const videosStr = meta.allVideos.length > 0
    ? `Top ${meta.allVideos.length} vídeos mais vistos de TODOS OS TEMPOS:\n${meta.allVideos.join("\n")}`
    : "Sem dados de vídeos";

  const engajamento = meta.subscribers > 0 && meta.mediaViews > 0
    ? ((meta.mediaViews / meta.subscribers) * 100).toFixed(1)
    : null;

  const contexto = `Analise este CANAL considerando TODO o histórico:

- Nome: ${meta.channelName}
- Plataforma: ${meta.platform}
- Inscritos: ${fmtNum(meta.subscribers)}
- Total de vídeos no canal: ${meta.totalVideos}
- Média de views por vídeo (todos os tempos): ${meta.mediaViewsStr}${engajamento ? `\n- Taxa de engajamento (views/inscritos): ${engajamento}%` : ""}

${videosStr}

${meta.subscribers > 100000 ? `Canal com ${fmtNum(meta.subscribers)} inscritos já tem credibilidade estabelecida.` : ""} ${meta.mediaViews > meta.subscribers ? "Média de views SUPERA inscritos — sinal MUITO POSITIVO de viralidade." : ""}`;

  const ai = await gerarPrevisao(contexto, meta.channelName);

  return {
    tipo: "canal",
    titulo: meta.channelName,
    canal: meta.channelName,
    plataforma: meta.platform,
    views: meta.mediaViews,
    inscritos: meta.subscribers,
    totalVideos: meta.totalVideos,
    videosRecentes: meta.allVideos,
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
    throw new Error("Não consegui analisar este link. Verifique se é válido.");
  }
}
