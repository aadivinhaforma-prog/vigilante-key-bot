import { db, ensureUser, getSistema, UserRow } from "./db";
import { eventosAtivos, EventoAtivo } from "./eventos";

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

export interface FichasInfo {
  fichas: number;
  fichasMax: number;
  proximaFicha?: { em: number };       // ms até próxima ficha disponível
  proximaRecarga?: { em: number };     // ms até reset completo
  intervaloHoras: number;
  recargaDias: number;
  vipAtivo: boolean;
  vipInfinito: boolean;
  bonusFidelidade: boolean;
  eventos: EventoAtivo[];
}

/**
 * Aplica regras de eventos e VIP na configuração efetiva do usuário.
 * Retorna fichas máximas, intervalo e recarga efetivos para HOJE.
 */
function configEfetiva(user: UserRow): {
  fichasMax: number;
  intervaloHoras: number;
  recargaDias: number;
  vipAtivo: boolean;
  vipInfinito: boolean;
  bonusFidelidade: boolean;
  eventos: EventoAtivo[];
} {
  const eventos = eventosAtivos();
  let fichasMax = user.fichas_max;
  let intervaloHoras = user.intervalo_horas;
  const recargaDias = user.recarga_dias;
  const now = Date.now();

  // Bônus de fidelidade (item 51): 30+ dias de uso → +1 ficha por semana
  let bonusFidelidade = false;
  if (user.primeiro_uso && now - user.primeiro_uso > 30 * DIA_MS) {
    fichasMax += 1;
    bonusFidelidade = true;
  }

  const vipInfinito = user.vip_infinito === 1;
  const vipAtivo = vipInfinito || (user.vip_ate !== null && user.vip_ate > now);

  // VIP clássico: dobra fichas, sem espera, recarga 3 dias
  if (vipAtivo && !vipInfinito) {
    fichasMax = Math.max(fichasMax, 6);
    intervaloHoras = 0;
  }

  // Eventos: aplica multiplicadores
  for (const ev of eventos) {
    if (ev.diaMentira) continue; // dia da mentira mente, não muda nada de verdade
    if (ev.multFichas > 1) fichasMax = Math.round(fichasMax * ev.multFichas);
    if (ev.intervaloHoras !== null) {
      if (ev.intervaloHoras === -1) intervaloHoras = Math.max(0, Math.floor(intervaloHoras / 2));
      else intervaloHoras = ev.intervaloHoras;
    }
  }

  return { fichasMax, intervaloHoras, recargaDias, vipAtivo, vipInfinito, bonusFidelidade, eventos };
}

export function getFichas(userId: string): FichasInfo {
  const user = ensureUser(userId);
  const cfg = configEfetiva(user);
  const now = Date.now();

  let fichas = user.fichas;

  // VIP infinito: sempre tem fichas
  if (cfg.vipInfinito) {
    return {
      fichas: 999,
      fichasMax: 999,
      intervaloHoras: 0,
      recargaDias: 0,
      vipAtivo: true,
      vipInfinito: true,
      bonusFidelidade: cfg.bonusFidelidade,
      eventos: cfg.eventos,
    };
  }

  // Verifica se precisa recarregar
  if (fichas <= 0 && user.proxima_recarga_em && user.proxima_recarga_em <= now) {
    fichas = cfg.fichasMax;
    db.prepare(`UPDATE users SET fichas = ?, proxima_recarga_em = NULL, ultima_ficha_em = NULL WHERE user_id = ?`)
      .run(fichas, userId);
  }

  // Aplica bônus de eventos (uma vez por dia para Páscoa, etc)
  // Implementado como ficha extra que aparece no contador.
  // Para simplicidade: bônus de eventos só são aplicados uma vez ao usar.

  const result: FichasInfo = {
    fichas,
    fichasMax: cfg.fichasMax,
    intervaloHoras: cfg.intervaloHoras,
    recargaDias: cfg.recargaDias,
    vipAtivo: cfg.vipAtivo,
    vipInfinito: cfg.vipInfinito,
    bonusFidelidade: cfg.bonusFidelidade,
    eventos: cfg.eventos,
  };

  if (fichas <= 0 && user.proxima_recarga_em) {
    result.proximaRecarga = { em: Math.max(0, user.proxima_recarga_em - now) };
  }
  if (fichas > 0 && fichas < cfg.fichasMax && user.ultima_ficha_em) {
    const proxima = user.ultima_ficha_em + cfg.intervaloHoras * HORA_MS;
    if (proxima > now) result.proximaFicha = { em: proxima - now };
  }

  return result;
}

export type GastoStatus =
  | { ok: true; restantes: number; eventoAplicado?: string }
  | { ok: false; razao: "sem_fichas"; proximaRecarga: number }
  | { ok: false; razao: "aguardar_intervalo"; segundos: number };

export function podeGastar(userId: string): GastoStatus {
  const info = getFichas(userId);
  const user = ensureUser(userId);
  const now = Date.now();

  if (info.vipInfinito) return { ok: true, restantes: 999 };

  if (info.fichas <= 0) {
    const proxima = user.proxima_recarga_em ?? now + info.recargaDias * DIA_MS;
    return { ok: false, razao: "sem_fichas", proximaRecarga: proxima };
  }

  // Intervalo entre fichas (item 8)
  if (
    info.intervaloHoras > 0 &&
    user.ultima_ficha_em &&
    info.fichas < info.fichasMax
  ) {
    const proxima = user.ultima_ficha_em + info.intervaloHoras * 60 * 60 * 1000;
    if (proxima > now) {
      return { ok: false, razao: "aguardar_intervalo", segundos: Math.ceil((proxima - now) / 1000) };
    }
  }

  return { ok: true, restantes: info.fichas - 1 };
}

export function gastarFicha(userId: string): GastoStatus {
  const status = podeGastar(userId);
  if (!status.ok) return status;

  const user = ensureUser(userId);
  const info = getFichas(userId);
  const now = Date.now();

  if (info.vipInfinito) return { ok: true, restantes: 999 };

  const novasFichas = user.fichas - 1;
  let proximaRecarga = user.proxima_recarga_em;
  if (novasFichas <= 0 && !proximaRecarga) {
    proximaRecarga = now + info.recargaDias * DIA_MS;
  }

  db.prepare(`
    UPDATE users SET fichas = ?, ultima_ficha_em = ?, proxima_recarga_em = ?, total_baixados = total_baixados + 1
    WHERE user_id = ?
  `).run(novasFichas, now, proximaRecarga, userId);

  return { ok: true, restantes: novasFichas };
}

export function devolverFicha(userId: string): void {
  const user = ensureUser(userId);
  const info = getFichas(userId);
  const novas = Math.min(info.fichasMax, user.fichas + 1);
  db.prepare(`UPDATE users SET fichas = ?, total_baixados = MAX(0, total_baixados - 1) WHERE user_id = ?`)
    .run(novas, userId);
}

// ─── Comandos administrativos ────────────────────────────────

export function setFichas(userId: string, qtd: number): void {
  ensureUser(userId);
  db.prepare(`UPDATE users SET fichas = ? WHERE user_id = ?`).run(qtd, userId);
}

export function addFichas(userId: string, qtd: number): void {
  ensureUser(userId);
  db.prepare(`UPDATE users SET fichas = fichas + ? WHERE user_id = ?`).run(qtd, userId);
}

export function setFichasMax(userId: string, qtd: number): void {
  ensureUser(userId);
  db.prepare(`UPDATE users SET fichas_max = ? WHERE user_id = ?`).run(qtd, userId);
}

export function setIntervaloHoras(userId: string, horas: number): void {
  ensureUser(userId);
  db.prepare(`UPDATE users SET intervalo_horas = ? WHERE user_id = ?`).run(horas, userId);
}

export function setRecargaDias(userId: string, dias: number): void {
  ensureUser(userId);
  db.prepare(`UPDATE users SET recarga_dias = ? WHERE user_id = ?`).run(dias, userId);
}

export function resetarFichas(userId: string): void {
  ensureUser(userId);
  const user = ensureUser(userId);
  db.prepare(`UPDATE users SET fichas = ?, ultima_ficha_em = NULL, proxima_recarga_em = NULL WHERE user_id = ?`)
    .run(user.fichas_max, userId);
}

export function setVipInfinito(userId: string, on: boolean): void {
  ensureUser(userId);
  db.prepare(`UPDATE users SET vip_infinito = ? WHERE user_id = ?`).run(on ? 1 : 0, userId);
}

export function setVipDias(userId: string, dias: number): void {
  ensureUser(userId);
  const ate = Date.now() + dias * DIA_MS;
  db.prepare(`UPDATE users SET vip_ate = ? WHERE user_id = ?`).run(ate, userId);
}

export function removerVip(userId: string): void {
  db.prepare(`UPDATE users SET vip_ate = NULL, vip_infinito = 0 WHERE user_id = ?`).run(userId);
}

export function listarVips(): Array<{ user_id: string; vip_ate: number | null; vip_infinito: number }> {
  return db.prepare(`SELECT user_id, vip_ate, vip_infinito FROM users WHERE vip_infinito = 1 OR (vip_ate IS NOT NULL AND vip_ate > ?)`)
    .all(Date.now()) as any[];
}

// Resetar TUDO (reset global)
export function resetarTudo(): void {
  const fichasGlobal = parseInt(getSistema("fichas_global") || "3");
  db.prepare(`UPDATE users SET fichas = fichas_max, ultima_ficha_em = NULL, proxima_recarga_em = NULL`).run();
}

// Reseta apenas usuários de um servidor específico (não há vínculo direto, então é noop por enquanto)
// (mantido para compatibilidade futura)
export function resetarServidor(_guildId: string): void {
  // Sem vínculo user→servidor no banco; reseta todos
  resetarTudo();
}

// ─── Formatadores ────────────────────────────────────────────

export function formatTempo(ms: number): string {
  if (ms <= 0) return "agora";
  const total = Math.floor(ms / 1000);
  const dias = Math.floor(total / 86400);
  const horas = Math.floor((total % 86400) / 3600);
  const min = Math.floor((total % 3600) / 60);
  const seg = total % 60;
  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${min}min`;
  if (min > 0) return `${min}min ${seg}s`;
  return `${seg}s`;
}
