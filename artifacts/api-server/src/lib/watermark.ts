import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Aplica marca d'água com o @ do criador CENTRALIZADA no vídeo.
 * Texto grande, semitransparente (~35%), visível durante todo o vídeo.
 * Usa ffmpeg drawtext. SE FALHAR, lança erro — o vídeo NÃO deve ser enviado sem watermark.
 *
 * @param inputPath caminho do vídeo de entrada
 * @param creatorHandle nome ou @ do criador original
 * @returns caminho do vídeo com watermark (substitui o original)
 */
export async function aplicarWatermark(inputPath: string, creatorHandle: string): Promise<string> {
  if (!fs.existsSync(inputPath)) {
    throw new Error("Arquivo de vídeo não encontrado para aplicar marca d'água");
  }

  // Sanitiza @ — adiciona se não tem
  let handle = creatorHandle.trim().replace(/[^\w\d._-]/g, "");
  if (!handle) handle = "criador";
  const texto = `@${handle}`;

  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath) || ".mp4";
  const base = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${base}_wm${ext}`);

  // Escapa caracteres especiais do drawtext
  const textoEscapado = texto.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

  // drawtext CENTRALIZADO:
  // - fontsize=h/10  -> letras grandes (10% da altura)
  // - fontcolor=white@0.35 -> ~35% de opacidade (semitransparente)
  // - borderw sutil só pra dar legibilidade em fundos claros
  // - x/y centralizados via (W-text_w)/2 e (H-text_h)/2
  // - sem timing -> visível durante TODO o vídeo
  const drawtext =
    `drawtext=text='${textoEscapado}':` +
    `fontcolor=white@0.35:fontsize=h/10:` +
    `borderw=2:bordercolor=black@0.25:` +
    `x=(w-text_w)/2:y=(h-text_h)/2`;

  try {
    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-vf", drawtext,
      "-c:a", "copy",
      "-preset", "ultrafast",
      "-y",
      outputPath,
    ], { timeout: 90000, maxBuffer: 50 * 1024 * 1024 });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Arquivo de saída do ffmpeg não foi criado");
    }

    // Substitui o original
    try { fs.unlinkSync(inputPath); } catch { /* ignora */ }
    fs.renameSync(outputPath, inputPath);
    return inputPath;
  } catch (err) {
    logger.error({ err, inputPath, creatorHandle }, "Falha ao aplicar marca d'água");
    // Limpa arquivo parcial
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignora */ }
    throw new Error("Não foi possível adicionar a marca d'água. O vídeo não será enviado para proteger o criador original.");
  }
}
