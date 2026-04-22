import { db } from "./db";

const HORAS_24_MS = 24 * 60 * 60 * 1000;

export interface RegistroAcao {
  id: number;
  ator_id: string;
  tipo_ator: "adm" | "owner";
  guild_id: string | null;
  acao: string;
  payload_anterior: string | null;
  reversivel: number;
  desfeita: number;
  executada_em: number;
}

export function registrarAcao(
  atorId: string,
  tipoAtor: "adm" | "owner",
  guildId: string | null,
  acao: string,
  payloadAnterior: unknown = null,
  reversivel = true
): number {
  const result = db.prepare(`
    INSERT INTO acoes (ator_id, tipo_ator, guild_id, acao, payload_anterior, reversivel, executada_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    atorId, tipoAtor, guildId, acao,
    payloadAnterior ? JSON.stringify(payloadAnterior) : null,
    reversivel ? 1 : 0,
    Date.now()
  );
  return result.lastInsertRowid as number;
}

export function ultimasAcoes(atorId: string, tipoAtor: "adm" | "owner", limite = 10): RegistroAcao[] {
  const cutoff = Date.now() - HORAS_24_MS;
  return db.prepare(`
    SELECT * FROM acoes
    WHERE ator_id = ? AND tipo_ator = ? AND executada_em >= ? AND desfeita = 0 AND reversivel = 1
    ORDER BY executada_em DESC LIMIT ?
  `).all(atorId, tipoAtor, cutoff, limite) as unknown as RegistroAcao[];
}

export function historicoAcoes(atorId: string, tipoAtor: "adm" | "owner", limite = 10): RegistroAcao[] {
  return db.prepare(`
    SELECT * FROM acoes
    WHERE ator_id = ? AND tipo_ator = ?
    ORDER BY executada_em DESC LIMIT ?
  `).all(atorId, tipoAtor, limite) as unknown as RegistroAcao[];
}

export function marcarDesfeita(id: number): void {
  db.prepare(`UPDATE acoes SET desfeita = 1 WHERE id = ?`).run(id);
}

/** Reverte uma ação aplicando o payload anterior. Retorna true se conseguiu desfazer. */
export function desfazerAcao(acao: RegistroAcao): boolean {
  if (!acao.reversivel || acao.desfeita) return false;

  let payload: any = null;
  if (acao.payload_anterior) {
    try { payload = JSON.parse(acao.payload_anterior); } catch { return false; }
  }

  try {
    // Cada tipo de ação tem seu jeito de reverter. Aqui tratamos os principais.
    if (acao.acao.startsWith("ban_servidor:") && payload?.guild_id && payload?.user_id) {
      db.prepare(`DELETE FROM bans_servidor WHERE user_id = ? AND guild_id = ?`).run(payload.user_id, payload.guild_id);
    } else if (acao.acao.startsWith("desban_servidor:") && payload?.guild_id && payload?.user_id) {
      db.prepare(`INSERT OR IGNORE INTO bans_servidor (user_id, guild_id, banido_em, motivo) VALUES (?, ?, ?, ?)`)
        .run(payload.user_id, payload.guild_id, payload.banido_em ?? Date.now(), payload.motivo ?? null);
    } else if (acao.acao.startsWith("ban_global:") && payload?.user_id) {
      db.prepare(`UPDATE users SET banido_global = 0, motivo_ban = NULL WHERE user_id = ?`).run(payload.user_id);
    } else if (acao.acao.startsWith("desban_global:") && payload?.user_id) {
      db.prepare(`UPDATE users SET banido_global = 1, motivo_ban = ? WHERE user_id = ?`)
        .run(payload.motivo ?? null, payload.user_id);
    } else if (acao.acao.startsWith("set_fichas:") && payload?.user_id && typeof payload.fichas_anterior === "number") {
      db.prepare(`UPDATE users SET fichas = ? WHERE user_id = ?`).run(payload.fichas_anterior, payload.user_id);
    } else if (acao.acao.startsWith("config_servidor:") && payload?.guild_id) {
      // restaura snapshot completo
      const cols = ["canal_permitido", "destino_modo", "destino_canal", "limite_diario", "bloqueado"];
      const sets = cols.filter((c) => c in payload).map((c) => `${c} = ?`).join(", ");
      const vals = cols.filter((c) => c in payload).map((c) => payload[c]);
      if (sets) {
        db.prepare(`UPDATE servidor_config SET ${sets} WHERE guild_id = ?`).run(...vals, payload.guild_id);
      }
    } else if (acao.acao.startsWith("bloqueio:") && payload?.id) {
      db.prepare(`DELETE FROM bloqueios WHERE id = ?`).run(payload.id);
    } else if (acao.acao.startsWith("desbloqueio:") && payload?.tipo) {
      db.prepare(`INSERT INTO bloqueios (tipo, identificador, escopo, criado_em, criado_por) VALUES (?, ?, ?, ?, ?)`)
        .run(payload.tipo, payload.identificador, payload.escopo, payload.criado_em ?? Date.now(), payload.criado_por ?? "");
    } else if (acao.acao.startsWith("addadmin:") && payload?.user_id) {
      db.prepare(`DELETE FROM admins_bot WHERE user_id = ?`).run(payload.user_id);
    } else if (acao.acao.startsWith("removeadmin:") && payload?.user_id) {
      db.prepare(`INSERT OR IGNORE INTO admins_bot (user_id, adicionado_em, adicionado_por) VALUES (?, ?, ?)`)
        .run(payload.user_id, payload.adicionado_em ?? Date.now(), payload.adicionado_por ?? "");
    } else {
      return false;
    }

    marcarDesfeita(acao.id);
    return true;
  } catch {
    return false;
  }
}
