import OpenAI from "openai";
import { logger } from "./lib/logger";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

export interface TrendingItem {
  rank: number;
  titulo: string;
  canal: string;
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

export async function analyzeTrending(
  plataforma: string,
  categoria: string,
  tema: string
): Promise<TrendingResult> {
  const contexto = buildContexto(plataforma, categoria, tema);

  const prompt = `Você é o VIGILANTE, um sistema de inteligência de tendências virais para criadores de conteúdo.

Contexto da busca:
- Plataforma: ${plataforma}
- Categoria: ${categoria || "Geral (Top Mundial)"}
- Tema/Alvo: ${tema || "Melhor da categoria"}

${contexto}

Gere EXATAMENTE 10 itens de tendência. Responda APENAS com um JSON válido neste formato (sem markdown, sem explicação):

{
  "itens": [
    {
      "rank": 1,
      "titulo": "título realista do vídeo/conteúdo viral",
      "canal": "nome do canal/perfil (realista para a plataforma)",
      "status": "EXPLODINDO",
      "crescimento": "+847%",
      "audioViral": "Nome da música viral usada (artista - música ou 'Som Original')",
      "dica": "Dica estratégica real e específica para replicar o sucesso desse conteúdo"
    }
  ]
}

Regras:
- status deve ser "EXPLODINDO" (vídeos acima de +200% de crescimento) ou "EM ASCENSÃO" (abaixo de +200%)
- crescimento deve ser realista (entre +50% e +2000%)
- dica deve ser PRÁTICA e ESPECÍFICA para criadores de conteúdo
- audioViral deve ser uma música real ou "Som Original"
- títulos devem parecer reais para a plataforma
- #1 deve sempre ser "EXPLODINDO"`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(content);
    const itens: TrendingItem[] = parsed.itens.map((item: TrendingItem) => ({
      rank: item.rank,
      titulo: item.titulo,
      canal: item.canal,
      status: item.status,
      crescimento: item.crescimento,
      audioViral: item.audioViral,
      dica: item.dica,
    }));

    return {
      plataforma,
      categoria: categoria || "🌍 Top Geral",
      tema: tema || "",
      itens,
      geradoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };
  } catch (err) {
    logger.error({ err, content }, "Erro ao parsear resposta do trending");
    throw new Error("Não consegui processar os dados de tendência.");
  }
}

function buildContexto(plataforma: string, categoria: string, tema: string): string {
  if (!categoria && !tema) {
    return `MISSÃO: Varredura geral. Traga o TOP 10 de conteúdos que estão DOMINANDO ${plataforma} agora. O que mais pessoas estão assistindo/curtindo no mundo todo.`;
  }
  if (categoria && !tema) {
    return `MISSÃO: O usuário quer "${categoria}" mas não especificou quem. VOCÊ decide o alvo mais famoso do momento dentro dessa categoria e busca o TOP 10. Mencione no titulo que você escolheu o alvo.`;
  }
  return `MISSÃO: Busca combinada — "${categoria}" + "${tema}". Traga o TOP 10 de "${categoria} de ${tema}" que estão viralizando agora.`;
}
