import { execFile } from "child_process";
import { promisify } from "util";
import OpenAI from "openai";
import { logger } from "./lib/logger";

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

// ─── Busca vídeos REAIS via yt-dlp ─────────────────────────

async function fetchRealVideos(
  plataforma: string,
  categoria: string,
  tema: string
): Promise<RawVideo[]> {
  const query = buildQuery(plataforma, categoria, tema);
  const ytdlpArgs = buildYtdlpArgs(plataforma, query);

  try {
    const { stdout } = await execFileAsync("yt-dlp", ytdlpArgs, {
      timeout: 60000,
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    const videos: RawVideo[] = [];

    for (const line of lines) {
      const parts = line.split("|||");
      if (parts.length < 4) continue;
      const [title, channel, viewsStr, id] = parts;
      if (!title || title === "NA" || !id || id === "NA") continue;

      const views = parseInt(viewsStr) || 0;
      const url = buildUrl(plataforma, id);

      videos.push({ title, channel: channel || "Desconhecido", views, id, url });
    }

    return videos.slice(0, 10);
  } catch (err) {
    logger.error({ err }, "yt-dlp falhou ao buscar trending");
    throw new Error("Não consegui acessar os dados reais da plataforma.");
  }
}

function buildQuery(plataforma: string, categoria: string, tema: string): string {
  if (!categoria && !tema) return "";
  const parts = [categoria, tema].filter(Boolean);
  const base = parts.join(" ");

  if (plataforma === "YouTube Shorts") return `${base} #shorts`;
  if (plataforma === "TikTok") return base;
  return base;
}

function buildYtdlpArgs(plataforma: string, query: string): string[] {
  const printFormat = "%(title)s|||%(channel)s|||%(view_count)s|||%(id)s";
  const baseArgs = [
    "--flat-playlist",
    "--print", printFormat,
    "--playlist-items", "1-10",
    "--extractor-args", "youtube:player_client=ios",
    "--no-warnings",
  ];

  // Sem query = busca trending geral da plataforma
  if (!query) {
    if (plataforma === "YouTube" || plataforma === "YouTube Shorts") {
      return [...baseArgs, "https://www.youtube.com/feed/trending"];
    }
    if (plataforma === "TikTok") {
      return [...baseArgs, "--no-extractor-args", "ytsearch10:tiktok trending viral 2025"];
    }
    if (plataforma === "Instagram Reels") {
      return [...baseArgs, "--no-extractor-args", "ytsearch10:instagram reels trending viral 2025"];
    }
  }

  // Com query = busca por tema específico
  if (plataforma === "YouTube Shorts") {
    return [...baseArgs, `ytsearch10:${query} shorts`];
  }
  if (plataforma === "TikTok") {
    return ["--flat-playlist", "--print", printFormat, "--playlist-items", "1-10", "--no-warnings", `ytsearch10:tiktok ${query}`];
  }
  if (plataforma === "Instagram Reels") {
    return ["--flat-playlist", "--print", printFormat, "--playlist-items", "1-10", "--no-warnings", `ytsearch10:instagram reels ${query}`];
  }

  // YouTube padrão
  return [...baseArgs, `ytsearch10:${query}`];
}

function buildUrl(plataforma: string, id: string): string {
  if (plataforma === "YouTube Shorts") return `https://youtube.com/shorts/${id}`;
  if (plataforma === "TikTok") return `https://youtube.com/watch?v=${id}`;
  if (plataforma === "Instagram Reels") return `https://youtube.com/watch?v=${id}`;
  return `https://youtube.com/watch?v=${id}`;
}

function formatViews(views: number): string {
  if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)}B`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(0)}K`;
  return String(views);
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

Para CADA vídeo, gere exatamente este JSON (sem markdown):

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
- status: "EXPLODINDO" se views acima de 500K, senão "EM ASCENSÃO"
- crescimento: estimativa realista baseada nos views (entre +50% e +2000%)
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
    // fallback sem enriquecimento
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
