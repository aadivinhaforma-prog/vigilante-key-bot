import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import FormData from "form-data";
import axios from "axios";
import OpenAI from "openai";
import { logger } from "./lib/logger";
import { aplicarWatermark } from "./lib/watermark";
import { retry, classificarErroDownload, ytDlpAntibloqueio } from "./lib/safety";

const execFileAsync = promisify(execFile);

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const AUDD_API_KEY = process.env.AUDD_API_KEY;

export interface MusicResult {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  timestamp: string;
  spotifyUrl?: string;
  appleUrl?: string;
}

export interface VideoInfo {
  title: string;
  duration: number;
  uploader: string;
  platform: string;
  url: string;
  isShort: boolean;
  isLive: boolean;
  fileSize?: number;
  views: number;
  channelSubs: number;
  thumbnail?: string;
  uploaderHandle: string;
}

export interface AnalysisResult {
  videoInfo: VideoInfo;
  music: MusicResult[];
  transcript: string;
}

export class VideoValidationError extends Error {
  constructor(public mensagem: string) {
    super(mensagem);
    this.name = "VideoValidationError";
  }
}

function detectPlatform(url: string): string {
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    if (url.includes("/shorts/")) return "YouTube Shorts";
    return "YouTube";
  }
  if (url.includes("tiktok.com")) return "TikTok";
  if (url.includes("instagram.com")) return "Instagram";
  return "Vídeo";
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await retry(() => execFileAsync("yt-dlp", [
    ...ytDlpAntibloqueio(),
    "--print",
    "%(title)s\n%(duration)s\n%(uploader)s\n%(filesize_approx)s\n%(view_count)s\n%(is_live)s\n%(channel_follower_count)s\n%(thumbnail)s\n%(uploader_id)s",
    "--no-download",
    "--no-warnings",
    url,
  ], { timeout: 30000 }));

  const lines = stdout.trim().split("\n");
  const title = lines[0] || "Sem título";
  const duration = parseFloat(lines[1]) || 0;
  const uploader = lines[2] || "Desconhecido";
  const fileSize = parseFloat(lines[3]) || 0;
  const views = parseInt(lines[4]) || 0;
  const isLive = lines[5]?.trim() === "True";
  const channelSubs = parseInt(lines[6]) || 0;
  const thumbnail = lines[7] || undefined;
  const uploaderHandle = (lines[8] || uploader).replace(/^@/, "");
  const platform = detectPlatform(url);
  const isShort = duration <= 180;

  return { title, duration, uploader, platform, url, isShort, isLive, fileSize, views, channelSubs, thumbnail, uploaderHandle };
}

/**
 * Valida se um vídeo pode ser BAIXADO (regras dos itens 14, 15, 20, 21, 35).
 * Lança VideoValidationError com mensagem amigável.
 */
export function validarParaDownload(info: VideoInfo): void {
  if (info.isLive) {
    throw new VideoValidationError("❌ Não baixo transmissões ao vivo. Tente quando o vídeo estiver gravado.");
  }
  if (info.duration > 0 && info.duration < 3) {
    throw new VideoValidationError("❌ Vídeo muito curto (menos de 3 segundos). Não é possível baixar.");
  }
  if (info.duration > 600) {
    throw new VideoValidationError("❌ Vídeo acima de 10 minutos. Por segurança, só baixo vídeos curtos.");
  }
  if (info.channelSubs > 0 && info.channelSubs < 100) {
    throw new VideoValidationError("❌ Não baixo vídeos de criadores com menos de 100 inscritos. Isso protege pequenos criadores.");
  }
}

async function downloadAudio(url: string, outputPath: string): Promise<void> {
  const args = [
    ...ytDlpAntibloqueio(),
    "-x", "--audio-format", "mp3", "--audio-quality", "0",
    "--no-warnings",
    "-o", outputPath, url,
  ];
  await execFileAsync("yt-dlp", args, { timeout: 90000 });
}

async function detectMusicInSegment(audioPath: string, offsetSeconds: number): Promise<MusicResult | null> {
  if (!AUDD_API_KEY) return null;
  try {
    const formData = new FormData();
    formData.append("api_token", AUDD_API_KEY);
    formData.append("file", fs.createReadStream(audioPath));
    formData.append("return", "spotify,apple_music,deezer");

    const response = await axios.post("https://api.audd.io/", formData, {
      headers: formData.getHeaders(),
      timeout: 30000,
    });

    const result = response.data?.result;
    if (!result) return null;

    const minutes = Math.floor(offsetSeconds / 60);
    const seconds = Math.floor(offsetSeconds % 60);
    const timestamp = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    return {
      title: result.title || "Desconhecida",
      artist: result.artist || "Desconhecido",
      album: result.album,
      releaseDate: result.release_date,
      timestamp,
      spotifyUrl: result.spotify?.external_urls?.spotify,
      appleUrl: result.apple_music?.url,
    };
  } catch {
    return null;
  }
}

async function extractSegment(audioPath: string, startSeconds: number, durationSeconds: number, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-i", audioPath,
    "-ss", String(startSeconds),
    "-t", String(durationSeconds),
    "-ar", "44100", "-ac", "1", "-y",
    outputPath,
  ]);
}

async function detectAllMusic(audioPath: string, videoDuration: number): Promise<MusicResult[]> {
  const results: MusicResult[] = [];
  const seen = new Set<string>();
  const segmentDuration = 30;
  const step = 60;

  const checkPoints: number[] = [];
  for (let t = 0; t < videoDuration; t += step) {
    checkPoints.push(t);
  }
  if (videoDuration > 30 && !checkPoints.includes(videoDuration - 30)) {
    checkPoints.push(videoDuration - 30);
  }

  const tmpDir = os.tmpdir();
  for (const offset of checkPoints) {
    const segPath = path.join(tmpDir, `seg_${offset}_${Date.now()}.mp3`);
    try {
      await extractSegment(audioPath, offset, segmentDuration, segPath);
      const music = await detectMusicInSegment(segPath, offset);
      if (music) {
        const key = `${music.title}|${music.artist}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(music);
        }
      }
    } catch { /* segue */ }
    finally {
      if (fs.existsSync(segPath)) fs.unlinkSync(segPath);
    }
  }
  return results;
}

async function transcribeAudio(audioPath: string): Promise<string> {
  try {
    const audioBuffer = fs.readFileSync(audioPath);
    const file = new File([audioBuffer], "audio.mp3", { type: "audio/mpeg" });
    const response = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      response_format: "json",
    });
    return (response as { text: string }).text || "";
  } catch (err) {
    logger.error({ err }, "Erro ao transcrever áudio");
    return "";
  }
}

/** Análise de áudio: música + transcrição. NÃO baixa vídeo. */
export async function analyzeVideo(url: string, videoInfo?: VideoInfo): Promise<AnalysisResult> {
  const info = videoInfo ?? await getVideoInfo(url);
  const tmpDir = os.tmpdir();
  const audioPath = path.join(tmpDir, `audio_${Date.now()}.mp3`);

  try {
    await retry(() => downloadAudio(url, audioPath));
    const [music, transcript] = await Promise.all([
      detectAllMusic(audioPath, info.duration),
      transcribeAudio(audioPath),
    ]);
    return { videoInfo: info, music, transcript };
  } catch (err) {
    throw new Error(classificarErroDownload(err));
  } finally {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

/**
 * Baixa o arquivo do vídeo, aplica marca d'água, e retorna o caminho.
 * Lança erro se falhar (incluindo se watermark falhar — protege criador).
 */
export async function downloadVideoComWatermark(url: string, info: VideoInfo): Promise<string> {
  validarParaDownload(info);

  const tmpDir = os.tmpdir();
  const sessionId = Date.now();
  const videoPath = path.join(tmpDir, `video_${sessionId}.mp4`);
  const template = videoPath.replace(".mp4", ".%(ext)s");

  const baseArgs = ytDlpAntibloqueio();
  const attempts = [
    [...baseArgs, "-f", "best[ext=mp4]/best", "--max-filesize", "24M", "--no-warnings", "-o", template, url],
    [...baseArgs, "--max-filesize", "24M", "--no-warnings", "-o", template, url],
  ];

  let downloaded = false;
  let lastErr: unknown;
  for (const args of attempts) {
    try {
      await execFileAsync("yt-dlp", args, { timeout: 90000 });
      downloaded = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!downloaded) throw new Error(classificarErroDownload(lastErr));

  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, ".mp4");
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(base));
  if (files.length === 0) throw new Error("❌ Não encontrei o arquivo após o download.");
  const arquivoBaixado = path.join(dir, files[0]);

  // Verifica tamanho (item 17)
  const stat = fs.statSync(arquivoBaixado);
  if (stat.size > 25 * 1024 * 1024) {
    fs.unlinkSync(arquivoBaixado);
    throw new Error("❌ Vídeo acima de 25MB — limite do Discord. Te mando só o link.");
  }

  // Aplica watermark — se falhar, lança erro e cancela envio (item 16)
  try {
    await aplicarWatermark(arquivoBaixado, info.uploaderHandle);
  } catch (err) {
    try { fs.unlinkSync(arquivoBaixado); } catch { /* ignora */ }
    throw err;
  }

  return arquivoBaixado;
}

export { formatDuration };
