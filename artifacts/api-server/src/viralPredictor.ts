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
  titulo: string;
  canal: string;
  plataforma: string;
  views: number;
  duracao: number;
  veredicto: "VAI BOMBAR" | "NÃO VAI BOMBAR";
  confianca: number;
  motivo: string;
  pontosFavoraveis: string[];
  pontosContra: string[];
  dicaMelhora: string;
}

async function getVideoMeta(url: string): Promise<{
  title: string;
  channel: string;
  views: number;
  duration: number;
  likeCount: number;
  platform: string;
}> {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--print", "%(title)s\n%(channel)s\n%(view_count)s\n%(duration)s\n%(like_count)s",
    "--no-download",
    "--extractor-args", "youtube:player_client=ios",
    url,
  ], { timeout: 30000 });

  const lines = stdout.trim().split("\n");
  const title = lines[0] || "Sem título";
  const channel = lines[1] || "Desconhecido";
  const views = parseInt(lines[2]) || 0;
  const duration = parseFloat(lines[3]) || 0;
  const likeCount = parseInt(lines[4]) || 0;

  let platform = "Vídeo";
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    platform = url.includes("/shorts/") ? "YouTube Shorts" : "YouTube";
  } else if (url.includes("tiktok.com")) {
    platform = "TikTok";
  } else if (url.includes("instagram.com")) {
    platform = "Instagram";
  }

  return { title, channel, views, duration, likeCount, platform };
}

export async function preverViral(url: string): Promise<PrevisaoResult> {
  const meta = await getVideoMeta(url);

  const viewsK = meta.views >= 1_000_000
    ? `${(meta.views / 1_000_000).toFixed(1)}M`
    : meta.views >= 1_000
    ? `${(meta.views / 1_000).toFixed(0)}K`
    : String(meta.views);

  const duracaoMin = Math.floor(meta.duration / 60);
  const duracaoSec = Math.floor(meta.duration % 60);
  const duracaoStr = `${duracaoMin}:${duracaoSec.toString().padStart(2, "0")}`;

  const prompt = `Você é o VIGILANTE, um sistema de análise de viralidade para criadores de conteúdo.

Analise este vídeo e preveja se ele tem potencial de BOMBAR (viralizar):

- Título: "${meta.title}"
- Canal: ${meta.channel}
- Plataforma: ${meta.platform}
- Views atuais: ${viewsK}
- Curtidas: ${meta.likeCount > 0 ? meta.likeCount : "N/D"}
- Duração: ${duracaoStr}

Responda APENAS com JSON válido (sem markdown):

{
  "veredicto": "VAI BOMBAR",
  "confianca": 72,
  "motivo": "Explicação curta e direta do porquê (máx 2 frases)",
  "pontosFavoraveis": ["ponto 1", "ponto 2", "ponto 3"],
  "pontosContra": ["ponto 1", "ponto 2"],
  "dicaMelhora": "Uma dica concreta para aumentar as chances de viralizar"
}

Regras:
- veredicto: "VAI BOMBAR" ou "NÃO VAI BOMBAR"
- confianca: número de 10 a 90 (NUNCA 100, NUNCA 0)
- pontosFavoraveis: 2 a 4 pontos reais baseados nos dados
- pontosContra: 1 a 3 pontos reais
- Se views já são altos (>1M), tende a VAI BOMBAR
- Se views são baixos e canal pequeno, pode ser AINDA NÃO DESCOBERTO (pode ir para qualquer lado)`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 800,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(content);
    return {
      titulo: meta.title,
      canal: meta.channel,
      plataforma: meta.platform,
      views: meta.views,
      duracao: meta.duration,
      veredicto: parsed.veredicto,
      confianca: Math.min(90, Math.max(10, parsed.confianca)),
      motivo: parsed.motivo,
      pontosFavoraveis: parsed.pontosFavoraveis || [],
      pontosContra: parsed.pontosContra || [],
      dicaMelhora: parsed.dicaMelhora || "",
    };
  } catch (err) {
    logger.error({ err, content }, "Erro ao parsear previsão");
    throw new Error("Não consegui processar a previsão.");
  }
}
