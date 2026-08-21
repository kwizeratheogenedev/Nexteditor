import fsp from 'fs/promises';

// Transcription runs against Groq's hosted Whisper API rather than a local
// whisper.cpp binary - Windows Smart App Control blocks unsigned local
// executables like whisper.cpp on machines where it's enabled (confirmed:
// even `whisper-cli.exe -h` alone gets killed with no output), with no
// reliable per-app exception once it's on. Unlike OpenAI's API, Groq
// rejects response_format=srt ("must be one of [json text verbose_json]" -
// confirmed against the live API), so this requests verbose_json and builds
// SRT text from its segments itself, matching the shape offsetSrt() below
// already expects from local whisper.cpp's own SRT output.
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.GROQ_TRANSCRIBE_TIMEOUT || '300000', 10);

async function transcribeChunkWithGroq(chunkPath, { language, prompt }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Captions aren\'t configured yet - add GROQ_API_KEY to backend/.env (free at console.groq.com/keys).');
  }

  const fileBuffer = await fsp.readFile(chunkPath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), 'chunk.mp3');
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Groq transcription failed (${response.status}).`;
      try {
        const data = await response.json();
        message = data?.error?.message || message;
      } catch { /* body wasn't JSON - keep the generic message */ }
      throw new Error(message);
    }
    const data = await response.json();
    return segmentsToSrt(data.segments || []);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Groq transcription timed out after ${Math.round(REQUEST_TIMEOUT_MS / 60000)} minutes.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// verbose_json's segments give start/end in seconds (float) - reuses the
// same formatTimestamp() the rest of this file already has for local
// whisper.cpp's millisecond-based SRT output.
function segmentsToSrt(segments) {
  return segments
    .map((segment, i) => {
      const text = (segment.text || '').trim();
      if (!text) return null;
      return `${i + 1}\n${formatTimestamp(segment.start * 1000)} --> ${formatTimestamp(segment.end * 1000)}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function getWhisperStatus() {
  return { ready: Boolean(process.env.GROQ_API_KEY), engine: 'groq-whisper', model: GROQ_MODEL, local: false };
}

export async function transcribeChunks(chunkPaths, { language, prompt, onProgress } = {}) {
  const combined = [];
  let nextIndex = 1;

  for (let index = 0; index < chunkPaths.length; index += 1) {
    onProgress?.(index, chunkPaths.length);
    // eslint-disable-next-line no-await-in-loop
    const srt = await transcribeChunkWithGroq(chunkPaths[index], { language, prompt });
    const adjusted = offsetSrt(srt, index * 1200, nextIndex);
    nextIndex = adjusted.nextIndex;
    if (adjusted.text) combined.push(adjusted.text);
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
  for (const block of srt.replace(/^﻿/, '').trim().split(/\r?\n\s*\r?\n/)) {
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
