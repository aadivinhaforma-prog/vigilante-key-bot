import { db } from "./db";

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
const MES_MS = 30 * 24 * 60 * 60 * 1000;

export function adicionarHistorico(
  userId: string,
  titulo: string,
  plataforma: string,
  guildId: string | null,
  chanceViral: number | null = null
): void {
  db.prepare(`
    INSERT INTO historico (user_id, titulo, plataforma, chance_viral, guild_id, baixado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, titulo.slice(0, 200), plataforma, chanceViral, guildId, Date.now());

  // Mantém apenas últimos 100 por usuário
  db.prepare(`
    DELETE FROM historico WHERE user_id = ? AND id NOT IN (
      SELECT id FROM historico WHERE user_id = ? ORDER BY baixado_em DESC LIMIT 100
    )
  `).run(userId, userId);
}

export function ultimosHistorico(userId: string, limite = 5): Array<{ titulo: string; plataforma: string; baixado_em: number; chance_viral: number | null }> {
  return db.prepare(`
    SELECT titulo, plataforma, baixado_em, chance_viral
    FROM historico WHERE user_id = ? ORDER BY baixado_em DESC LIMIT ?
  `).all(userId, limite) as any[];
}

export function topVirais(guildId: string, limite = 3): Array<{ titulo: string; plataforma: string; chance_viral: number; baixado_em: number }> {
  const cutoff = Date.now() - SEMANA_MS;
  return db.prepare(`
    SELECT titulo, plataforma, chance_viral, baixado_em
    FROM historico
    WHERE guild_id = ? AND baixado_em >= ? AND chance_viral IS NOT NULL
    ORDER BY chance_viral DESC, baixado_em DESC
    LIMIT ?
  `).all(guildId, cutoff, limite) as any[];
}

export function rankingMes(guildId: string, limite = 10): Array<{ user_id: string; total: number }> {
  const cutoff = Date.now() - MES_MS;
  return db.prepare(`
    SELECT user_id, COUNT(*) AS total
    FROM historico
    WHERE guild_id = ? AND baixado_em >= ?
    GROUP BY user_id
    ORDER BY total DESC
    LIMIT ?
  `).all(guildId, cutoff, limite) as any[];
}

export function totalServidor(guildId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM historico WHERE guild_id = ?`).get(guildId) as { total: number };
  return row.total;
}

// ─── Conquistas (item 49) ────────────────────────────────────

interface ConquistaDef {
  nome: string;
  emoji: string;
  meta: number;
}

export const CONQUISTAS: ConquistaDef[] = [
  { nome: "Iniciante", emoji: "🎬", meta: 1 },
  { nome: "Analista", emoji: "📊", meta: 10 },
  { nome: "Expert", emoji: "🏆", meta: 50 },
  { nome: "Lendário", emoji: "👑", meta: 100 },
];

/** Verifica se o usuário desbloqueou novas conquistas. Retorna as recém-desbloqueadas. */
export function checarConquistas(userId: string, totalBaixados: number): ConquistaDef[] {
  const desbloqueadas = db.prepare(`SELECT nome FROM conquistas WHERE user_id = ?`).all(userId) as { nome: string }[];
  const jaTem = new Set(desbloqueadas.map((c) => c.nome));

  const novas: ConquistaDef[] = [];
  for (const c of CONQUISTAS) {
    if (totalBaixados >= c.meta && !jaTem.has(c.nome)) {
      db.prepare(`INSERT OR IGNORE INTO conquistas (user_id, nome, desbloqueada_em) VALUES (?, ?, ?)`)
        .run(userId, c.nome, Date.now());
      novas.push(c);
    }
  }
  return novas;
}

export function listarConquistasUsuario(userId: string): ConquistaDef[] {
  const rows = db.prepare(`SELECT nome FROM conquistas WHERE user_id = ?`).all(userId) as { nome: string }[];
  const nomes = new Set(rows.map((r) => r.nome));
  return CONQUISTAS.filter((c) => nomes.has(c.nome));
}
