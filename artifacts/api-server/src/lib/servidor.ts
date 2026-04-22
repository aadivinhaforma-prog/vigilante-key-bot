import { db } from "./db";

export interface ServidorConfig {
  guild_id: string;
  canal_permitido: string | null;
  destino_modo: "servidor" | "canal" | "dm";
  destino_canal: string | null;
  limite_diario: number;
  bloqueado: number;
}

export function getConfig(guildId: string): ServidorConfig {
  let row = db.prepare(`SELECT * FROM servidor_config WHERE guild_id = ?`).get(guildId) as unknown as ServidorConfig | undefined;
  if (!row) {
    db.prepare(`INSERT INTO servidor_config (guild_id) VALUES (?)`).run(guildId);
    row = db.prepare(`SELECT * FROM servidor_config WHERE guild_id = ?`).get(guildId) as unknown as ServidorConfig;
  }
  return row;
}

export function setCanalPermitido(guildId: string, channelId: string | null): ServidorConfig {
  getConfig(guildId);
  db.prepare(`UPDATE servidor_config SET canal_permitido = ? WHERE guild_id = ?`).run(channelId, guildId);
  return getConfig(guildId);
}

export function setLimiteDiario(guildId: string, limite: number): ServidorConfig {
  getConfig(guildId);
  db.prepare(`UPDATE servidor_config SET limite_diario = ? WHERE guild_id = ?`).run(Math.max(1, limite), guildId);
  return getConfig(guildId);
}

export function setDestino(
  guildId: string,
  modo: "servidor" | "canal" | "dm",
  canal: string | null = null
): ServidorConfig {
  getConfig(guildId);
  db.prepare(`UPDATE servidor_config SET destino_modo = ?, destino_canal = ? WHERE guild_id = ?`)
    .run(modo, canal, guildId);
  return getConfig(guildId);
}

export function setBloqueado(guildId: string, on: boolean): ServidorConfig {
  getConfig(guildId);
  db.prepare(`UPDATE servidor_config SET bloqueado = ? WHERE guild_id = ?`).run(on ? 1 : 0, guildId);
  return getConfig(guildId);
}

export function isServidorBloqueado(guildId: string): boolean {
  const row = db.prepare(`SELECT bloqueado FROM servidor_config WHERE guild_id = ?`).get(guildId) as { bloqueado: number } | undefined;
  return row?.bloqueado === 1;
}

// ─── Bans no servidor ────────────────────────────────────────

export function banirNoServidor(userId: string, guildId: string, motivo: string | null = null): void {
  db.prepare(`
    INSERT INTO bans_servidor (user_id, guild_id, banido_em, motivo)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, guild_id) DO UPDATE SET banido_em = excluded.banido_em, motivo = excluded.motivo
  `).run(userId, guildId, Date.now(), motivo);
}

export function desbanirNoServidor(userId: string, guildId: string): boolean {
  const result = db.prepare(`DELETE FROM bans_servidor WHERE user_id = ? AND guild_id = ?`).run(userId, guildId);
  return result.changes > 0;
}

export function isBanidoNoServidor(userId: string, guildId: string): boolean {
  const row = db.prepare(`SELECT 1 FROM bans_servidor WHERE user_id = ? AND guild_id = ?`).get(userId, guildId);
  return !!row;
}

export function listarServidores(): Array<{ guild_id: string; downloads_total: number; usuarios: number }> {
  return db.prepare(`
    SELECT
      sc.guild_id,
      COALESCE((SELECT SUM(downloads) FROM uso_diario WHERE guild_id = sc.guild_id), 0) AS downloads_total,
      (SELECT COUNT(DISTINCT user_id) FROM historico WHERE guild_id = sc.guild_id) AS usuarios
    FROM servidor_config sc
  `).all() as any[];
}

export function statusDoDia(guildId: string): { downloads: number; bloqueados: number; fichas_usadas: number } {
  const data = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  })();
  const dRow = db.prepare(`SELECT downloads FROM uso_diario WHERE guild_id = ? AND data = ?`).get(guildId, data) as { downloads: number } | undefined;
  const bRow = db.prepare(`SELECT COUNT(*) AS c FROM bans_servidor WHERE guild_id = ?`).get(guildId) as { c: number };
  return {
    downloads: dRow?.downloads ?? 0,
    bloqueados: bRow.c,
    fichas_usadas: dRow?.downloads ?? 0,
  };
}
