import { db } from "./db";

// Janela do anti-spam: 5 comandos em 60s → bloqueia por 10min
const SPAM_WINDOW_MS = 60_000;
const SPAM_LIMIT = 5;
const SPAM_BLOCK_MS = 10 * 60 * 1000;

// Delay obrigatório entre comandos do mesmo usuário (item 30)
const COMMAND_DELAY_MS = 5_000;

// Limpa parâmetros de tracking de URLs (item 2)
export function cleanLink(url: string): string {
  let trimmed = url.trim();

  // Remove tudo após "?" para Instagram e TikTok (rastreadores)
  if (
    trimmed.includes("instagram.com") ||
    trimmed.includes("tiktok.com")
  ) {
    const idx = trimmed.indexOf("?");
    if (idx !== -1) trimmed = trimmed.slice(0, idx);
  }

  // YouTube: mantém apenas o parâmetro v= (e shorts/ etc)
  if (trimmed.includes("youtube.com/watch")) {
    try {
      const u = new URL(trimmed);
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    } catch { /* segue */ }
  }

  return trimmed;
}

// Lista de palavras proibidas (filtro de conteúdo - item 15)
const PALAVRAS_PROIBIDAS = [
  "porn", "porno", "xxx", "sex tape", "nude", "nudes", "onlyfans",
  "violencia", "violência", "assassinato", "tortura", "decapitacao",
  "decapitação", "estupro", "pedofilia", "pedo", "child abuse",
  "gore", "snuff", "execucao", "execução",
];

export function temConteudoProibido(titulo: string): boolean {
  const lower = titulo.toLowerCase();
  return PALAVRAS_PROIBIDAS.some((p) => lower.includes(p));
}

// Sites adultos bloqueados (item 27)
const SITES_ADULTOS = [
  "pornhub.com", "xvideos.com", "xnxx.com", "redtube.com",
  "youporn.com", "spankbang.com", "xhamster.com", "onlyfans.com",
  "chaturbate.com", "stripchat.com", "cam4.com", "brazzers.com",
];

export function isSiteAdulto(url: string): boolean {
  const lower = url.toLowerCase();
  return SITES_ADULTOS.some((s) => lower.includes(s));
}

// Encurtadores bloqueados (item 23)
const ENCURTADORES = [
  "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly",
  "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorte.st",
  "encurtador.com", "shorturl.at",
];

export function isEncurtador(url: string): boolean {
  const lower = url.toLowerCase();
  return ENCURTADORES.some((s) => lower.includes(s));
}

// Plataformas permitidas (itens 19, 38)
export function plataformaSuportada(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("tiktok.com") ||
    lower.includes("instagram.com")
  );
}

// Validação de URL geral (item 18)
export function isUrlValida(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export type ValidacaoLinkErro =
  | "url_invalida"
  | "encurtador"
  | "site_adulto"
  | "plataforma_nao_suportada";

export function validarLink(url: string): { ok: true; url: string } | { ok: false; erro: ValidacaoLinkErro } {
  const cleaned = cleanLink(url);
  if (!isUrlValida(cleaned)) return { ok: false, erro: "url_invalida" };
  if (isSiteAdulto(cleaned)) return { ok: false, erro: "site_adulto" };
  if (isEncurtador(cleaned)) return { ok: false, erro: "encurtador" };
  if (!plataformaSuportada(cleaned)) return { ok: false, erro: "plataforma_nao_suportada" };
  return { ok: true, url: cleaned };
}

export function mensagemErroLink(erro: ValidacaoLinkErro): string {
  switch (erro) {
    case "url_invalida": return "❌ Link inválido. Verifique e tente novamente.";
    case "encurtador": return "❌ Links encurtados não são permitidos. Use o link original.";
    case "site_adulto": return "❌ Esse tipo de site não é permitido.";
    case "plataforma_nao_suportada": return "❌ Plataforma não suportada. Use links do YouTube, TikTok ou Instagram.";
  }
}

// Identifica o tipo de erro do yt-dlp para mensagem clara (item 5)
export function classificarErroDownload(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("private") || lower.includes("removed") || lower.includes("unavailable") || lower.includes("deleted")) {
    return "❌ Este vídeo está privado, removido ou indisponível.";
  }
  if (lower.includes("login required") || lower.includes("sign in")) {
    return "❌ Esse vídeo exige login para ser acessado e não pode ser baixado.";
  }
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("econnreset")) {
    return "❌ Erro de conexão. Tente novamente em alguns instantes.";
  }
  if (lower.includes("copyright") || lower.includes("blocked")) {
    return "❌ Este vídeo está bloqueado por direitos autorais ou indisponível na sua região.";
  }
  if (lower.includes("not a valid url") || lower.includes("invalid url")) {
    return "❌ Link inválido. Verifique e tente novamente.";
  }
  return "❌ Não consegui processar esse vídeo agora. Tente em alguns minutos.";
}

// Retry com 3s de espera (item 3)
export async function retry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 3000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// ─── Anti-spam (item 22) ─────────────────────────────────────

interface SpamRow {
  user_id: string;
  bloqueado_ate: number | null;
  comandos_recentes: string | null;
}

export type SpamStatus =
  | { ok: true }
  | { ok: false; razao: "bloqueado"; segundos: number }
  | { ok: false; razao: "delay"; segundos: number };

/** Verifica e atualiza o anti-spam. Retorna ok:true se pode prosseguir. */
export function checkAntiSpam(userId: string): SpamStatus {
  const now = Date.now();
  const row = db.prepare("SELECT * FROM rate_limit WHERE user_id = ?").get(userId) as SpamRow | undefined;

  if (row?.bloqueado_ate && row.bloqueado_ate > now) {
    return { ok: false, razao: "bloqueado", segundos: Math.ceil((row.bloqueado_ate - now) / 1000) };
  }

  let recentes: number[] = [];
  if (row?.comandos_recentes) {
    try { recentes = JSON.parse(row.comandos_recentes); } catch { recentes = []; }
  }
  // remove timestamps fora da janela
  recentes = recentes.filter((t) => now - t < SPAM_WINDOW_MS);

  // Delay obrigatório (item 30)
  if (recentes.length > 0) {
    const desdeUltimo = now - recentes[recentes.length - 1];
    if (desdeUltimo < COMMAND_DELAY_MS) {
      return { ok: false, razao: "delay", segundos: Math.ceil((COMMAND_DELAY_MS - desdeUltimo) / 1000) };
    }
  }

  recentes.push(now);

  // Detecta spam (5+ em 1min)
  if (recentes.length >= SPAM_LIMIT) {
    const bloqueio = now + SPAM_BLOCK_MS;
    db.prepare(`
      INSERT INTO rate_limit (user_id, bloqueado_ate, comandos_recentes)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET bloqueado_ate = excluded.bloqueado_ate, comandos_recentes = excluded.comandos_recentes
    `).run(userId, bloqueio, JSON.stringify([]));
    return { ok: false, razao: "bloqueado", segundos: Math.ceil(SPAM_BLOCK_MS / 1000) };
  }

  db.prepare(`
    INSERT INTO rate_limit (user_id, bloqueado_ate, comandos_recentes)
    VALUES (?, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET comandos_recentes = excluded.comandos_recentes
  `).run(userId, JSON.stringify(recentes));

  return { ok: true };
}

// ─── Link duplicado (item 24) ────────────────────────────────

const LINK_DUPLICADO_MS = 60 * 60 * 1000; // 1 hora

export function linkDuplicado(userId: string, url: string): boolean {
  const cutoff = Date.now() - LINK_DUPLICADO_MS;
  const row = db.prepare(`
    SELECT enviado_em FROM link_recente WHERE user_id = ? AND url = ?
  `).get(userId, url) as { enviado_em: number } | undefined;

  if (row && row.enviado_em > cutoff) return true;

  db.prepare(`
    INSERT INTO link_recente (user_id, url, enviado_em)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, url) DO UPDATE SET enviado_em = excluded.enviado_em
  `).run(userId, url, Date.now());

  // Limpa antigos
  db.prepare("DELETE FROM link_recente WHERE enviado_em < ?").run(cutoff);

  return false;
}

// ─── Limite diário do servidor (item 29) ─────────────────────

function hoje(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function checkLimiteDiario(guildId: string): { ok: boolean; usado: number; max: number } {
  const config = db.prepare("SELECT limite_diario FROM servidor_config WHERE guild_id = ?").get(guildId) as { limite_diario: number } | undefined;
  const max = config?.limite_diario ?? 50;
  const data = hoje();
  const row = db.prepare("SELECT downloads FROM uso_diario WHERE guild_id = ? AND data = ?").get(guildId, data) as { downloads: number } | undefined;
  const usado = row?.downloads ?? 0;
  return { ok: usado < max, usado, max };
}

export function incrementaUsoDiario(guildId: string): void {
  const data = hoje();
  db.prepare(`
    INSERT INTO uso_diario (guild_id, data, downloads)
    VALUES (?, ?, 1)
    ON CONFLICT(guild_id, data) DO UPDATE SET downloads = downloads + 1
  `).run(guildId, data);
}

// ─── Limite de downloads do mesmo criador (item 36) ──────────

function semanaAtual(): string {
  const d = new Date();
  const start = new Date(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function checkLimiteCriador(userId: string, criador: string): { ok: boolean; usado: number; max: number } {
  const max = 3;
  const semana = semanaAtual();
  const norm = criador.trim().toLowerCase();
  const row = db.prepare(`
    SELECT count FROM downloads_criador WHERE user_id = ? AND criador = ? AND semana = ?
  `).get(userId, norm, semana) as { count: number } | undefined;
  const usado = row?.count ?? 0;
  return { ok: usado < max, usado, max };
}

export function incrementaCriador(userId: string, criador: string): void {
  const norm = criador.trim().toLowerCase();
  const semana = semanaAtual();
  db.prepare(`
    INSERT INTO downloads_criador (user_id, criador, semana, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, criador, semana) DO UPDATE SET count = count + 1
  `).run(userId, norm, semana);
}

// ─── Bloqueios (criador/vídeo) ───────────────────────────────

export function isBloqueado(
  identificador: string,
  guildId: string | null,
  userId: string
): boolean {
  const norm = identificador.trim().toLowerCase();
  const escopos = ["global", `usuario:${userId}`];
  if (guildId) escopos.push(`servidor:${guildId}`);

  const placeholders = escopos.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT 1 FROM bloqueios
    WHERE LOWER(identificador) = ? AND escopo IN (${placeholders})
    LIMIT 1
  `).get(norm, ...escopos);

  return !!row;
}

export function adicionarBloqueio(tipo: "criador" | "video", identificador: string, escopo: string, criadoPor: string): number {
  const result = db.prepare(`
    INSERT INTO bloqueios (tipo, identificador, escopo, criado_em, criado_por)
    VALUES (?, ?, ?, ?, ?)
  `).run(tipo, identificador.trim().toLowerCase(), escopo, Date.now(), criadoPor);
  return result.lastInsertRowid as number;
}

export function removerBloqueio(tipo: "criador" | "video", identificador: string, escopo: string): boolean {
  const result = db.prepare(`
    DELETE FROM bloqueios WHERE tipo = ? AND LOWER(identificador) = ? AND escopo = ?
  `).run(tipo, identificador.trim().toLowerCase(), escopo);
  return result.changes > 0;
}

export function listarBloqueios(escopo?: string): Array<{ id: number; tipo: string; identificador: string; escopo: string; criado_em: number }> {
  if (escopo) {
    return db.prepare("SELECT id, tipo, identificador, escopo, criado_em FROM bloqueios WHERE escopo = ? ORDER BY criado_em DESC").all(escopo) as any[];
  }
  return db.prepare("SELECT id, tipo, identificador, escopo, criado_em FROM bloqueios ORDER BY criado_em DESC").all() as any[];
}
