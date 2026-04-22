import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { logger } from "./logger";

export const OWNER_ID = "1467333025430900860";

const DB_PATH = path.join(process.cwd(), "data", "vigilante.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  fichas INTEGER NOT NULL DEFAULT 3,
  fichas_max INTEGER NOT NULL DEFAULT 3,
  intervalo_horas INTEGER NOT NULL DEFAULT 1,
  recarga_dias INTEGER NOT NULL DEFAULT 7,
  ultima_ficha_em INTEGER,
  proxima_recarga_em INTEGER,
  total_baixados INTEGER NOT NULL DEFAULT 0,
  vip_ate INTEGER,
  vip_infinito INTEGER NOT NULL DEFAULT 0,
  primeiro_uso INTEGER,
  banido_global INTEGER NOT NULL DEFAULT 0,
  motivo_ban TEXT,
  troll_efeito TEXT,
  troll_apelido TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bans_servidor (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  banido_em INTEGER NOT NULL,
  motivo TEXT,
  PRIMARY KEY (user_id, guild_id)
);

CREATE TABLE IF NOT EXISTS admins_bot (
  user_id TEXT PRIMARY KEY,
  adicionado_em INTEGER NOT NULL,
  adicionado_por TEXT
);

CREATE TABLE IF NOT EXISTS servidor_config (
  guild_id TEXT PRIMARY KEY,
  canal_permitido TEXT,
  destino_modo TEXT NOT NULL DEFAULT 'servidor',
  destino_canal TEXT,
  limite_diario INTEGER NOT NULL DEFAULT 50,
  bloqueado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uso_diario (
  guild_id TEXT NOT NULL,
  data TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, data)
);

CREATE TABLE IF NOT EXISTS downloads_criador (
  user_id TEXT NOT NULL,
  criador TEXT NOT NULL,
  semana TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, criador, semana)
);

CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  plataforma TEXT NOT NULL,
  chance_viral INTEGER,
  guild_id TEXT,
  baixado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bloqueios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  identificador TEXT NOT NULL,
  escopo TEXT NOT NULL,
  criado_em INTEGER NOT NULL,
  criado_por TEXT
);

CREATE TABLE IF NOT EXISTS acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ator_id TEXT NOT NULL,
  tipo_ator TEXT NOT NULL,
  guild_id TEXT,
  acao TEXT NOT NULL,
  payload_anterior TEXT,
  reversivel INTEGER NOT NULL DEFAULT 1,
  desfeita INTEGER NOT NULL DEFAULT 0,
  executada_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit (
  user_id TEXT PRIMARY KEY,
  bloqueado_ate INTEGER,
  comandos_recentes TEXT
);

CREATE TABLE IF NOT EXISTS link_recente (
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  enviado_em INTEGER NOT NULL,
  PRIMARY KEY (user_id, url)
);

CREATE TABLE IF NOT EXISTS eventos_manuais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  inicio INTEGER NOT NULL,
  fim INTEGER NOT NULL,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS sistema (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS conquistas (
  user_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  desbloqueada_em INTEGER NOT NULL,
  PRIMARY KEY (user_id, nome)
);

CREATE TABLE IF NOT EXISTS vip_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  nome TEXT,
  inicio INTEGER NOT NULL,
  fim INTEGER NOT NULL,
  config_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_historico_user ON historico(user_id, baixado_em DESC);
CREATE INDEX IF NOT EXISTS idx_historico_guild ON historico(guild_id, baixado_em DESC);
CREATE INDEX IF NOT EXISTS idx_acoes_ator ON acoes(ator_id, executada_em DESC);
CREATE INDEX IF NOT EXISTS idx_bloqueios_id ON bloqueios(identificador, escopo);
`);

logger.info({ path: DB_PATH }, "Banco de dados inicializado");

// ─── Helpers globais de sistema ──────────────────────────────

export function getSistema(chave: string): string | null {
  const row = db.prepare("SELECT valor FROM sistema WHERE chave = ?").get(chave) as { valor: string } | undefined;
  return row?.valor ?? null;
}

export function setSistema(chave: string, valor: string): void {
  db.prepare(`
    INSERT INTO sistema (chave, valor) VALUES (?, ?)
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
  `).run(chave, valor);
}

export function isManutencao(): boolean {
  return getSistema("manutencao") === "1";
}

export function setManutencao(on: boolean): void {
  setSistema("manutencao", on ? "1" : "0");
}

// ─── Garante usuário existe ──────────────────────────────────

export interface UserRow {
  user_id: string;
  fichas: number;
  fichas_max: number;
  intervalo_horas: number;
  recarga_dias: number;
  ultima_ficha_em: number | null;
  proxima_recarga_em: number | null;
  total_baixados: number;
  vip_ate: number | null;
  vip_infinito: number;
  primeiro_uso: number | null;
  banido_global: number;
  motivo_ban: string | null;
  troll_efeito: string | null;
  troll_apelido: string | null;
  created_at: number;
}

export function ensureUser(userId: string): UserRow {
  const existing = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as UserRow | undefined;
  if (existing) return existing;

  const now = Date.now();
  const fichasGlobal = parseInt(getSistema("fichas_global") || "3");
  const intervaloGlobal = parseInt(getSistema("intervalo_global") || "1");
  const diasGlobal = parseInt(getSistema("dias_global") || "7");

  db.prepare(`
    INSERT INTO users (user_id, fichas, fichas_max, intervalo_horas, recarga_dias, primeiro_uso, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, fichasGlobal, fichasGlobal, intervaloGlobal, diasGlobal, now, now);

  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as unknown as UserRow;
}

export function getUser(userId: string): UserRow | null {
  return (db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as unknown as UserRow | undefined) ?? null;
}
