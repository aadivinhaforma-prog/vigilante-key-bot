import { execFile } from "child_process";
import { promisify } from "util";
import OpenAI from "openai";
import { logger } from "./lib/logger";
import { ytDlpAntibloqueio } from "./lib/safety";

const execFileAsync = promisify(execFile);

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface TrendingItem {
  rank: number;
  titulo: string;
  canal: string;
  views: string;
  url: string;
  status: "EM ASCENSÃO" | "EXPLODINDO";
  crescimento: string;
  chanceViral: number; // 0-100%
  audioViral: string;
  dica: string;
}

export interface TrendingResult {
  plataforma: string;
  categoria: string;
  tema: string;
  itens: TrendingItem[];
  geradoEm: string;
}

interface RawVideo {
  title: string;
  channel: string;
  views: number;
  id: string;
  url: string;
}

// ─── Busca vídeos REAIS ordenados por views ─────────────────

async function fetchRealVideos(
  plataforma: string,
  categoria: string,
  tema: string
): Promise<RawVideo[]> {
  const printFormat = "%(title)s|||%(channel)s|||%(view_count)s|||%(id)s";

  let sourceUrl: string;

  if (!categoria && !tema) {
    // Trending geral: feed oficial do YouTube
    if (plataforma === "YouTube" || plataforma === "YouTube Shorts") {
      sourceUrl = "https://www.youtube.com/feed/trending";
    } else if (plataforma === "TikTok") {
      // YouTube search por trending tiktok ordenado por views
      sourceUrl = buildYouTubeSearchUrl("tiktok viral trending", true);
    } else {
      sourceUrl = buildYouTubeSearchUrl("instagram reels viral trending", true);
    }
  } else {
    // Busca específica: YouTube com ordenação por views (mais vistos)
    const query = buildQuery(plataforma, categoria, tema);
    sourceUrl = buildYouTubeSearchUrl(query, true);
  }

  const args = [
    ...ytDlpAntibloqueio(),
    "--flat-playlist",
    "--print", printFormat,
    "--playlist-items", "1-20", // pega 20 para filtrar melhor
    "--no-warnings",
    sourceUrl,
  ];

  try {
    const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 60000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    const videos: RawVideo[] = [];

    for (const line of lines) {
      const parts = line.split("|||");
      if (parts.length < 4) continue;
      const [title, channel, viewsStr, id] = parts;
      if (!title || title === "NA" || !id || id === "NA") continue;

      const views = parseInt(viewsStr) || 0;
      videos.push({
        title: title.trim(),
        channel: channel?.trim() || "Desconhecido",
        views,
        id,
        url: buildVideoUrl(plataforma, id),
      });
    }

    // Ordena por views descendente e pega top 10
    videos.sort((a, b) => b.views - a.views);
    return videos.slice(0, 10);
  } catch (err) {
    logger.error({ err }, "yt-dlp falhou ao buscar trending");
    throw new Error("Não consegui acessar os dados reais da plataforma.");
  }
}

// URL do YouTube com ordenação por "mais vistos" (sort by view count)
function buildYouTubeSearchUrl(query: string, sortByViews: boolean): string {
  const encoded = encodeURIComponent(query);
  // sp=CAM%3D ordena por view count (mais vistos)
  if (sortByViews) {
    return `https://www.youtube.com/results?search_query=${encoded}&sp=CAM%3D`;
  }
  return `https://www.youtube.com/results?search_query=${encoded}`;
}

function buildQuery(plataforma: string, categoria: string, tema: string): string {
  const parts = [categoria, tema].filter(Boolean);
  const base = parts.join(" ");
  if (plataforma === "YouTube Shorts") return `${base} shorts`;
  if (plataforma === "TikTok") return `${base} tiktok`;
  if (plataforma === "Instagram Reels") return `${base} reels instagram`;
  return base;
}

function buildVideoUrl(plataforma: string, id: string): string {
  if (plataforma === "YouTube Shorts") return `https://youtube.com/shorts/${id}`;
  return `https://youtube.com/watch?v=${id}`;
}

function formatViews(views: number): string {
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)}K`;
  return views > 0 ? String(views) : "N/D";
}

// Calcula % de chance de viralização baseado nos views reais
export function calcChanceViral(views: number, rank: number): number {
  // Escala logarítmica: 1M views = ~80%, 100M = ~99%, 10K = ~20%
  let base = 0;
  if (views >= 100_000_000) base = 95;
  else if (views >= 50_000_000) base = 90;
  else if (views >= 10_000_000) base = 82;
  else if (views >= 5_000_000) base = 75;
  else if (views >= 1_000_000) base = 65;
  else if (views >= 500_000) base = 52;
  else if (views >= 100_000) base = 40;
  else if (views >= 10_000) base = 25;
  else base = 12;

  // Bônus por rank (#1 ganha +5, #10 perde -5)
  const rankBonus = Math.round((10 - rank) * 0.8);
  return Math.min(99, Math.max(5, base + rankBonus));
}

// ─── IA adiciona dicas em cima dos dados reais ─────────────

async function enrichWithAI(
  videos: RawVideo[],
  plataforma: string,
  categoria: string,
  tema: string
): Promise<TrendingItem[]> {
  const listaVideos = videos
    .map((v, i) => `#${i + 1}: "${v.title}" — Canal: ${v.channel} (${formatViews(v.views)} views)`)
    .join("\n");

  const prompt = `Você é o VIGILANTE, especialista em tendências de conteúdo para criadores.

Esses são vídeos REAIS encontrados em ${plataforma} sobre "${[categoria, tema].filter(Boolean).join(" + ") || "trending geral"}":

${listaVideos}

Para CADA vídeo, gere exatamente este JSON (sem markdown, sem explicação):

{
  "itens": [
    {
      "rank": 1,
      "status": "EXPLODINDO",
      "crescimento": "+847%",
      "audioViral": "Nome da música viral desse nicho (artista - música, ou 'Som Original')",
      "dica": "Dica estratégica REAL e ESPECÍFICA para um criador replicar o sucesso desse tipo de vídeo"
    }
  ]
}

Regras:
- status: "EXPLODINDO" se views acima de 1M, senão "EM ASCENSÃO"
- crescimento: estimativa realista baseada nos views vs média do nicho
- dica: prática, específica, voltada para quem quer criar conteúdo similar
- audioViral: música que combina com o estilo do vídeo`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || "";
  let aiItems: Array<{
    rank: number;
    status: "EM ASCENSÃO" | "EXPLODINDO";
    crescimento: string;
    audioViral: string;
    dica: string;
  }> = [];

  try {
    const parsed = JSON.parse(content);
    aiItems = parsed.itens;
  } catch {
    aiItems = videos.map((_, i) => ({
      rank: i + 1,
      status: "EM ASCENSÃO" as const,
      crescimento: "+100%",
      audioViral: "Som Original",
      dica: "Analise o vídeo e replique o estilo de edição e ritmo.",
    }));
  }

  return videos.map((v, i) => {
    const ai = aiItems[i] || aiItems[0];
    return {
      rank: i + 1,
      titulo: v.title,
      canal: v.channel,
      views: formatViews(v.views),
      url: v.url,
      status: ai.status,
      crescimento: ai.crescimento,
      chanceViral: calcChanceViral(v.views, i + 1),
      audioViral: ai.audioViral,
      dica: ai.dica,
    };
  });
}

// ─── Exportado ──────────────────────────────────────────────

export async function analyzeTrending(
  plataforma: string,
  categoria: string,
  tema: string
): Promise<TrendingResult> {
  const videos = await fetchRealVideos(plataforma, categoria, tema);

  if (videos.length === 0) {
    throw new Error("Nenhum vídeo encontrado. Tente uma busca diferente.");
  }

  const itens = await enrichWithAI(videos, plataforma, categoria, tema);

  return {
    plataforma,
    categoria: categoria || "🌍 Top Geral",
    tema: tema || "",
    itens,
    geradoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}
