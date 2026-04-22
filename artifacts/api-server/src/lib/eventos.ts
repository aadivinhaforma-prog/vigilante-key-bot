import { db } from "./db";

// ─── Cálculo automático de feriados ──────────────────────────

/** Algoritmo de Computus para Páscoa (Gauss) */
function calcPascoa(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function calcCarnaval(year: number): Date {
  const pascoa = calcPascoa(year);
  // Carnaval = terça-feira, 47 dias antes da Páscoa
  const carnaval = new Date(pascoa);
  carnaval.setUTCDate(pascoa.getUTCDate() - 47);
  return carnaval;
}

function nthDow(year: number, month: number, dow: number, n: number): Date {
  // n-ésimo dia da semana do mês (dow: 0=domingo)
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (dow - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export interface EventoAtivo {
  nome: string;
  emoji: string;
  mensagem: string;
  /** Multiplica fichas máximas (2 = dobra, 3 = triplica). 1 = não muda */
  multFichas: number;
  /** Sobrescreve intervalo entre fichas (em horas). Null = não muda */
  intervaloHoras: number | null;
  /** +X fichas bônus instantâneas (somadas uma única vez por dia) */
  bonusFichas: number;
  /** Visual */
  cor: number;
  /** É uma "trollagem" do dia da mentira */
  diaMentira: boolean;
  /** Origem */
  origem: "automatico" | "manual";
  /** Data de fim (manual). Null = só hoje */
  fim?: number;
}

/** Lista todos os eventos automáticos ATIVOS hoje */
export function eventosAutomaticosHoje(now: Date = new Date()): EventoAtivo[] {
  const ativos: EventoAtivo[] = [];
  const ano = now.getUTCFullYear();
  const dia = now.getUTCDate();
  const mes = now.getUTCMonth() + 1;

  // 25/12 — Natal
  if (mes === 12 && dia === 25) {
    ativos.push({
      nome: "Natal", emoji: "🎄", mensagem: "🎄 Feliz Natal! Jesus nasceu e as fichas dobraram!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0x2e7d32, diaMentira: false, origem: "automatico",
    });
  }
  // 31/12 — Réveillon
  if (mes === 12 && dia === 31) {
    ativos.push({
      nome: "Réveillon", emoji: "🎉", mensagem: "🎉 Último dia do ano! Fichas dobradas!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0xffd700, diaMentira: false, origem: "automatico",
    });
  }
  // 01/01 — Ano Novo
  if (mes === 1 && dia === 1) {
    ativos.push({
      nome: "Ano Novo", emoji: "🎉", mensagem: "🎉 Feliz Ano Novo! Fichas dobradas!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0xffd700, diaMentira: false, origem: "automatico",
    });
  }
  // Carnaval (variável)
  if (sameDay(calcCarnaval(ano), now)) {
    ativos.push({
      nome: "Carnaval", emoji: "🎭", mensagem: "🎭 É Carnaval! Sem espera entre fichas hoje!",
      multFichas: 1, intervaloHoras: 0, bonusFichas: 0, cor: 0xe91e63, diaMentira: false, origem: "automatico",
    });
  }
  // 01/04 — Dia da Mentira
  if (mes === 4 && dia === 1) {
    ativos.push({
      nome: "Dia da Mentira", emoji: "🤥", mensagem: "🤥 Mentira! Fichas normais hoje hehe.",
      multFichas: 1, intervaloHoras: null, bonusFichas: 0, cor: 0x9e9e9e, diaMentira: true, origem: "automatico",
    });
  }
  // Páscoa (variável)
  if (sameDay(calcPascoa(ano), now)) {
    ativos.push({
      nome: "Páscoa", emoji: "🐣", mensagem: "🐣 Feliz Páscoa! Você ganhou +1 ficha escondida!",
      multFichas: 1, intervaloHoras: null, bonusFichas: 1, cor: 0xff9800, diaMentira: false, origem: "automatico",
    });
  }
  // Dia das Mães — 2º domingo de maio
  if (mes === 5 && sameDay(nthDow(ano, 4, 0, 2), now)) {
    ativos.push({
      nome: "Dia das Mães", emoji: "💐", mensagem: "💐 Feliz Dia das Mães! Fichas dobradas hoje!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0xe91e63, diaMentira: false, origem: "automatico",
    });
  }
  // 12/06 — Dia dos Namorados
  if (mes === 6 && dia === 12) {
    ativos.push({
      nome: "Dia dos Namorados", emoji: "💝", mensagem: "💝 Dia dos Namorados! Fichas dobradas!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0xe91e63, diaMentira: false, origem: "automatico",
    });
  }
  // 24/06 — Festa Junina
  if (mes === 6 && dia === 24) {
    ativos.push({
      nome: "Festa Junina", emoji: "🎶", mensagem: "🎶 Arraiá do Vigilante Key! Tempo entre fichas reduzido pela metade hoje!",
      multFichas: 1, intervaloHoras: -1, bonusFichas: 0, cor: 0xff6f00, diaMentira: false, origem: "automatico",
    });
    // intervaloHoras: -1 = sinal de "metade"
  }
  // Dia dos Pais — 2º domingo de agosto
  if (mes === 8 && sameDay(nthDow(ano, 7, 0, 2), now)) {
    ativos.push({
      nome: "Dia dos Pais", emoji: "👨", mensagem: "👨 Feliz Dia dos Pais! Fichas dobradas hoje!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0x1976d2, diaMentira: false, origem: "automatico",
    });
  }
  // 29/08 — Dia do Gamer
  if (mes === 8 && dia === 29) {
    ativos.push({
      nome: "Dia do Gamer", emoji: "🎮", mensagem: "🎮 PLAYER 1 ENTERED! Fichas dobradas hoje!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0x6a1b9a, diaMentira: false, origem: "automatico",
    });
  }
  // 12/10 — Dia das Crianças
  if (mes === 10 && dia === 12) {
    ativos.push({
      nome: "Dia das Crianças", emoji: "🎈", mensagem: "🎈 Feliz Dia das Crianças! Fichas TRIPLICADAS hoje!",
      multFichas: 3, intervaloHoras: null, bonusFichas: 0, cor: 0xff5722, diaMentira: false, origem: "automatico",
    });
  }
  // 31/10 — Halloween
  if (mes === 10 && dia === 31) {
    ativos.push({
      nome: "Halloween", emoji: "🎃", mensagem: "🎃 BOO! Suas fichas dobraram... se você sobreviver!",
      multFichas: 2, intervaloHoras: null, bonusFichas: 0, cor: 0xff6f00, diaMentira: false, origem: "automatico",
    });
  }

  return ativos;
}

/** Eventos manuais ativos agora */
export function eventosManuaisAtivos(): EventoAtivo[] {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT id, nome, inicio, fim, config_json FROM eventos_manuais WHERE inicio <= ? AND fim >= ?
  `).all(now, now) as Array<{ id: number; nome: string; inicio: number; fim: number; config_json: string | null }>;

  return rows.map((r) => {
    let config: Partial<EventoAtivo> = {};
    if (r.config_json) {
      try { config = JSON.parse(r.config_json); } catch { /* ignora */ }
    }
    return {
      nome: r.nome,
      emoji: config.emoji || "🎉",
      mensagem: config.mensagem || `🎉 Evento ativo: ${r.nome}`,
      multFichas: config.multFichas ?? 1,
      intervaloHoras: config.intervaloHoras ?? null,
      bonusFichas: config.bonusFichas ?? 0,
      cor: config.cor ?? 0xffeb3b,
      diaMentira: config.diaMentira ?? false,
      origem: "manual",
      fim: r.fim,
    };
  });
}

export function eventosAtivos(): EventoAtivo[] {
  return [...eventosAutomaticosHoje(), ...eventosManuaisAtivos()];
}

export function criarEventoManual(nome: string, inicio: number, fim: number, config: Partial<EventoAtivo>): number {
  const result = db.prepare(`
    INSERT INTO eventos_manuais (nome, inicio, fim, config_json) VALUES (?, ?, ?, ?)
  `).run(nome, inicio, fim, JSON.stringify(config));
  return result.lastInsertRowid as number;
}

export function listarEventosManuais(): Array<{ id: number; nome: string; inicio: number; fim: number }> {
  return db.prepare("SELECT id, nome, inicio, fim FROM eventos_manuais ORDER BY inicio DESC").all() as any[];
}

export function desligarEventosManuais(): number {
  const result = db.prepare("DELETE FROM eventos_manuais WHERE fim >= ?").run(Date.now());
  return Number(result.changes);
}

// Catálogo de eventos pré-definidos (para opção 1 do /owner-evento)
export const CATALOGO_EVENTOS: Record<string, Partial<EventoAtivo> & { nome: string; mensagem: string; emoji: string }> = {
  natal: { nome: "Natal", emoji: "🎄", mensagem: "🎄 Feliz Natal! Fichas dobradas!", multFichas: 2, cor: 0x2e7d32 },
  reveillon: { nome: "Réveillon", emoji: "🎉", mensagem: "🎉 Réveillon! Fichas dobradas!", multFichas: 2, cor: 0xffd700 },
  "ano-novo": { nome: "Ano Novo", emoji: "🎉", mensagem: "🎉 Feliz Ano Novo! Fichas dobradas!", multFichas: 2, cor: 0xffd700 },
  carnaval: { nome: "Carnaval", emoji: "🎭", mensagem: "🎭 Carnaval! Sem espera entre fichas!", multFichas: 1, intervaloHoras: 0, cor: 0xe91e63 },
  pascoa: { nome: "Páscoa", emoji: "🐣", mensagem: "🐣 Páscoa! +1 ficha bônus!", bonusFichas: 1, cor: 0xff9800 },
  "dia-das-maes": { nome: "Dia das Mães", emoji: "💐", mensagem: "💐 Fichas dobradas!", multFichas: 2, cor: 0xe91e63 },
  "dia-dos-namorados": { nome: "Dia dos Namorados", emoji: "💝", mensagem: "💝 Fichas dobradas!", multFichas: 2, cor: 0xe91e63 },
  "festa-junina": { nome: "Festa Junina", emoji: "🎶", mensagem: "🎶 Arraiá! Tempo reduzido pela metade!", intervaloHoras: -1, cor: 0xff6f00 },
  "dia-dos-pais": { nome: "Dia dos Pais", emoji: "👨", mensagem: "👨 Fichas dobradas!", multFichas: 2, cor: 0x1976d2 },
  "dia-do-gamer": { nome: "Dia do Gamer", emoji: "🎮", mensagem: "🎮 Fichas dobradas!", multFichas: 2, cor: 0x6a1b9a },
  "dia-das-criancas": { nome: "Dia das Crianças", emoji: "🎈", mensagem: "🎈 Fichas TRIPLICADAS!", multFichas: 3, cor: 0xff5722 },
  halloween: { nome: "Halloween", emoji: "🎃", mensagem: "🎃 Fichas dobradas!", multFichas: 2, cor: 0xff6f00 },
};
