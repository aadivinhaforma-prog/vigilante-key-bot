import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import FormData from "form-data";
import axios from "axios";
import OpenAI from "openai";
import { logger } from "./lib/logger";

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
  fileSize?: number;
  views: number;
}

export interface AnalysisResult {
  videoInfo: VideoInfo;
  music: MusicResult[];
  transcript: string;
  videoFilePath?: string;
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

async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--print",
    "%(title)s\n%(duration)s\n%(uploader)s\n%(filesize_approx)s\n%(view_count)s",
    "--no-download",
    url,
  ]);

  const lines = stdout.trim().split("\n");
  const title = lines[0] || "Sem título";
  const duration = parseFloat(lines[1]) || 0;
  const uploader = lines[2] || "Desconhecido";
  const fileSize = parseFloat(lines[3]) || 0;
  const views = parseInt(lines[4]) || 0;
  const platform = detectPlatform(url);
  const isShort = duration <= 180;

  return { title, duration, uploader, platform, url, isShort, fileSize, views };
}

async function downloadVideoFile(url: string, outputPath: string): Promise<string | null> {
  const template = outputPath.replace(".mp4", ".%(ext)s");

  const attempts = [
    // Tentativa 1: cliente iOS do YouTube (bypassa SABR)
    [
      "--extractor-args", "youtube:player_client=ios",
      "-f", "best[ext=mp4]/best",
      "--max-filesize", "24M",
      "-o", template, url,
    ],
    // Tentativa 2: cliente mweb
    [
      "--extractor-args", "youtube:player_client=mweb",
      "-f", "best[ext=mp4]/best",
      "--max-filesize", "24M",
      "-o", template, url,
    ],
    // Tentativa 3: sem restrição de formato
    [
      "--extractor-args", "youtube:player_client=ios",
      "--max-filesize", "24M",
      "-o", template, url,
    ],
  ];

  for (const args of attempts) {
    try {
      await execFileAsync("yt-dlp", args);
      break;
    } catch {
      // tenta próximo
    }
  }

  // yt-dlp pode mudar a extensão — procura o arquivo gerado
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, ".mp4");
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(base));
  if (files.length === 0) return null;
  return path.join(dir, files[0]);
}

async function downloadAudio(url: string, outputPath: string): Promise<void> {
  const attempts = [
    [
      "--extractor-args", "youtube:player_client=ios",
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
      "-o", outputPath, url,
    ],
    [
      "--extractor-args", "youtube:player_client=mweb",
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
      "-o", outputPath, url,
    ],
    [
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
      "-o", outputPath, url,
    ],
  ];

  let lastErr: unknown;
  for (const args of attempts) {
    try {
      await execFileAsync("yt-dlp", args);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function detectMusicInSegment(
  audioPath: string,
  offsetSeconds: number
): Promise<MusicResult | null> {
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

async function extractSegment(
  audioPath: string,
  startSeconds: number,
  durationSeconds: number,
  outputPath: string
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-i",
    audioPath,
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-ar",
    "44100",
    "-ac",
    "1",
    "-y",
    outputPath,
  ]);
}

async function detectAllMusic(
  audioPath: string,
  videoDuration: number
): Promise<MusicResult[]> {
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
    const segPath = path.join(tmpDir, `seg_${offset}.mp3`);
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
    } catch {
    } finally {
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

export async function analyzeVideo(url: string): Promise<AnalysisResult> {
  const tmpDir = os.tmpdir();
  const sessionId = Date.now();
  const audioPath = path.join(tmpDir, `audio_${sessionId}.mp3`);
  const videoPath = path.join(tmpDir, `video_${sessionId}.mp4`);

  try {
    const videoInfo = await getVideoInfo(url);

    await downloadAudio(url, audioPath);

    const [music, transcript] = await Promise.all([
      detectAllMusic(audioPath, videoInfo.duration),
      transcribeAudio(audioPath),
    ]);

    let videoFilePath: string | undefined;
    try {
      const downloaded = await downloadVideoFile(url, videoPath);
      if (downloaded && fs.existsSync(downloaded)) {
        const stat = fs.statSync(downloaded);
        if (stat.size <= 25 * 1024 * 1024) {
          videoFilePath = downloaded;
          logger.info({ size: stat.size, path: downloaded }, "Vídeo baixado para envio no Discord");
        } else {
          fs.unlinkSync(downloaded);
          logger.info({ size: stat.size }, "Vídeo muito grande para enviar no Discord (>25MB)");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Não foi possível baixar o vídeo para envio");
    }

    return { videoInfo, music, transcript, videoFilePath };
  } finally {
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

export { formatDuration };
