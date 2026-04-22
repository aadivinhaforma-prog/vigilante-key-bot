import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Aplica marca d'água com o @ do criador no canto inferior direito.
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

  // drawtext: texto branco com sombra preta no canto inferior direito
  // Usa fonte padrão do sistema; fontsize relativo à altura
  const drawtext =
    `drawtext=text='${textoEscapado}':` +
    `fontcolor=white:fontsize=h/22:` +
    `borderw=2:bordercolor=black@0.7:` +
    `box=1:boxcolor=black@0.45:boxborderw=8:` +
    `x=w-tw-20:y=h-th-20`;

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
