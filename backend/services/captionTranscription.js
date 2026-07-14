import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const backendRoot = process.cwd();
const defaultRuntime = path.join(backendRoot, 'whisper', 'runtime');
const defaultModel = path.join(backendRoot, 'whisper', 'models', 'ggml-base.bin');
const WHISPER_TIMEOUT = Number.parseInt(process.env.WHISPER_TIMEOUT || '3600000', 10);

function findFile(root, names) {
  if (!fs.existsSync(root)) return null;
  const matches = new Map();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (names.includes(entry.name.toLowerCase())) matches.set(entry.name.toLowerCase(), fullPath);
    }
  }
  for (const name of names) {
    if (matches.has(name)) return matches.get(name);
  }
  return null;
}

function resolveWhisperBinary() {
  if (process.env.WHISPER_CPP_PATH) return path.resolve(process.env.WHISPER_CPP_PATH);
  return findFile(defaultRuntime, process.platform === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'main']);
}

function runWhisper(inputPath, outputPrefix, { language, threads, onProgress }) {
  const binary = resolveWhisperBinary();
  const model = path.resolve(process.env.WHISPER_MODEL_PATH || defaultModel);
  if (!binary || !fs.existsSync(binary)) {
    throw new Error('Local Whisper is not installed. Run backend/scripts/setup-whisper.ps1 first.');
  }
  if (!fs.existsSync(model)) {
    throw new Error(`Whisper model not found: ${model}`);
  }

  const args = [
    '-m', model,
    '-f', path.resolve(inputPath),
    '-of', path.resolve(outputPrefix),
    '-osrt',
    '-pp',
    '-ml', '72',
    '-sow',
    '-l', language || 'auto',
    '-t', String(threads),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: path.dirname(binary), windowsHide: true });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      if (!settled) reject(new Error(`Local Whisper timed out after ${Math.round(WHISPER_TIMEOUT / 60000)} minutes.`));
      settled = true;
    }, WHISPER_TIMEOUT);

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const match of text.matchAll(/progress\s*=\s*(\d+)%/gi)) onProgress?.(Number(match[1]));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
      settled = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `Whisper exited with code ${code}.`));
      else resolve();
    });
  });
}

export function getWhisperStatus() {
  const binary = resolveWhisperBinary();
  const model = path.resolve(process.env.WHISPER_MODEL_PATH || defaultModel);
  return { ready: Boolean(binary && fs.existsSync(model)), binary, model, engine: 'whisper.cpp', local: true };
}

export async function transcribeChunks(chunkPaths, { language, onProgress } = {}) {
  const cpuCount = Number.parseInt(process.env.NUMBER_OF_PROCESSORS || '4', 10);
  const threads = Math.max(1, Number.parseInt(process.env.WHISPER_THREADS || String(Math.max(2, cpuCount - 1)), 10));
  const combined = [];
  let nextIndex = 1;

  for (let index = 0; index < chunkPaths.length; index += 1) {
    const outputPrefix = `${chunkPaths[index]}-captions`;
    await runWhisper(chunkPaths[index], outputPrefix, {
      language,
      threads,
      onProgress: (chunkPercent) => onProgress?.(index + chunkPercent / 100, chunkPaths.length),
    });
    const generatedPath = `${outputPrefix}.srt`;
    const srt = await fsp.readFile(generatedPath, 'utf8');
    const adjusted = offsetSrt(srt, index * 1200, nextIndex);
    nextIndex = adjusted.nextIndex;
    if (adjusted.text) combined.push(adjusted.text);
    await fsp.rm(generatedPath, { force: true });
    onProgress?.(index + 1, chunkPaths.length);
  }

  if (!combined.length) throw new Error('Whisper could not detect any spoken audio in this video.');
  return `${combined.join('\n\n')}\n`;
}

function parseTimestamp(value) {
  const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return null;
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4].padEnd(3, '0').slice(0, 3));
}

function formatTimestamp(milliseconds) {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const ms = safe % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function offsetSrt(srt, offsetSeconds, startingIndex) {
  let index = startingIndex;
  const output = [];
  for (const block of srt.replace(/^\uFEFF/, '').trim().split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startText, endText] = lines[timingIndex].split('-->').map((part) => part.trim());
    const start = parseTimestamp(startText);
    const end = parseTimestamp(endText);
    const text = lines.slice(timingIndex + 1).join(' ').replace(/\s+/g, ' ').trim();
    if (start === null || end === null || !text) continue;
    const sentences = splitCaptionText(text);
    const duration = Math.max(1, end - start);
    const totalWeight = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
    let elapsed = 0;
    for (const sentence of sentences) {
      const sentenceDuration = duration * (sentence.length / totalWeight);
      const cueStart = start + elapsed;
      elapsed += sentenceDuration;
      output.push(`${index}\n${formatTimestamp(cueStart + offsetSeconds * 1000)} --> ${formatTimestamp(start + elapsed + offsetSeconds * 1000)}\n${sentence}`);
      index += 1;
    }
  }
  return { text: output.join('\n\n'), nextIndex: index };
}

function splitCaptionText(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean);
  const readable = [];
  for (const sentence of sentences) {
    if (sentence.length <= 72) {
      readable.push(sentence);
      continue;
    }
    const words = sentence.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (line && `${line} ${word}`.length > 72) {
        readable.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) readable.push(line);
  }
  return readable.length ? readable : [text];
}
