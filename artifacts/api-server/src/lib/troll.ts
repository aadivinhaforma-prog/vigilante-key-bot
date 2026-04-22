import { db, ensureUser } from "./db";

export type TrollEfeito =
  | "mudo"
  | "lento"
  | "infinito"
  | "sem-ficha"
  | "errado"
  | "fantasma"
  | "loop"
  | "idioma"
  | "confuso"
  | "mini"
  | "eco"
  | "sempre-erro"
  | "apelido"
  | "falso-vip"
  | "contagem";

export const EFEITOS_VALIDOS: TrollEfeito[] = [
  "mudo", "lento", "infinito", "sem-ficha", "errado", "fantasma",
  "loop", "idioma", "confuso", "mini", "eco", "sempre-erro",
  "apelido", "falso-vip", "contagem",
];

export function setTrollEfeito(userId: string, efeito: TrollEfeito | null, apelido?: string): void {
  ensureUser(userId);
  if (efeito === null) {
    db.prepare(`UPDATE users SET troll_efeito = NULL, troll_apelido = NULL WHERE user_id = ?`).run(userId);
  } else {
    db.prepare(`UPDATE users SET troll_efeito = ?, troll_apelido = ? WHERE user_id = ?`)
      .run(efeito, apelido ?? null, userId);
  }
}

export function getTrollEfeito(userId: string): { efeito: TrollEfeito | null; apelido: string | null } {
  const row = db.prepare(`SELECT troll_efeito, troll_apelido FROM users WHERE user_id = ?`).get(userId) as
    { troll_efeito: string | null; troll_apelido: string | null } | undefined;
  return {
    efeito: (row?.troll_efeito as TrollEfeito | null) ?? null,
    apelido: row?.troll_apelido ?? null,
  };
}

export function listarTrolls(): Array<{ user_id: string; troll_efeito: string; troll_apelido: string | null }> {
  return db.prepare(`SELECT user_id, troll_efeito, troll_apelido FROM users WHERE troll_efeito IS NOT NULL`).all() as any[];
}

const MINI_MAP: Record<string, string> = {
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
  i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ",
  q: "ᵠ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ",
  y: "ʸ", z: "ᶻ",
};

export function transformarMini(texto: string): string {
  return texto.toLowerCase().split("").map((c) => MINI_MAP[c] ?? c).join("");
}

export function embaralharTexto(texto: string): string {
  return texto.split(" ").map((palavra) => {
    if (palavra.length <= 3) return palavra;
    const letras = palavra.split("");
    for (let i = letras.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letras[i], letras[j]] = [letras[j], letras[i]];
    }
    return letras.join("");
  }).join(" ");
}

const IDIOMAS_TROLL = ["japones", "arabe", "russo"] as const;

const RESPOSTAS_IDIOMA: Record<string, string[]> = {
  japones: [
    "申し訳ありませんが、リクエストを処理できませんでした。",
    "ご利用ありがとうございます。少々お待ちください。",
    "エラーが発生しました。もう一度お試しください。",
  ],
  arabe: [
    "عذراً، لا يمكنني معالجة طلبك في الوقت الحالي.",
    "شكراً لاستخدام البوت. يرجى الانتظار.",
    "حدث خطأ. يرجى المحاولة مرة أخرى.",
  ],
  russo: [
    "Извините, я не могу обработать ваш запрос.",
    "Спасибо за использование бота. Пожалуйста, подождите.",
    "Произошла ошибка. Попробуйте еще раз.",
  ],
};

export function respostaIdiomaAleatoria(): string {
  const idioma = IDIOMAS_TROLL[Math.floor(Math.random() * IDIOMAS_TROLL.length)];
  const respostas = RESPOSTAS_IDIOMA[idioma];
  return respostas[Math.floor(Math.random() * respostas.length)];
}

export function aplicarApelido(texto: string, apelido: string | null): string {
  if (!apelido) return texto;
  return `${apelido}, ${texto}`;
}

/**
 * Aplica transformações de trollagem no texto de resposta.
 * Retorna null se o efeito impede resposta (mudo, fantasma, infinito).
 */
export function aplicarEfeitoTroll(efeito: TrollEfeito | null, apelido: string | null, texto: string): string | null {
  if (!efeito) return texto;

  switch (efeito) {
    case "mudo":
    case "fantasma":
    case "infinito":
      return null; // não responde
    case "sempre-erro":
      return "❌ Não consegui processar agora. Tente novamente.";
    case "sem-ficha":
      return "❌ Você não tem fichas suficientes. Aguarde a recarga.";
    case "mini":
      return transformarMini(aplicarApelido(texto, apelido));
    case "confuso":
      return embaralharTexto(aplicarApelido(texto, apelido));
    case "idioma":
      return respostaIdiomaAleatoria();
    case "apelido":
      return aplicarApelido(texto, apelido);
    case "errado":
      return "🎬 Vídeo de gatinhos brincando — 1.2M views\n📺 Canal: Random Cat\n⭐ Análise concluída!";
    case "falso-vip":
      return "👑 VIP detectado! Processando sua requisição premium...";
    default:
      return texto;
  }
}
