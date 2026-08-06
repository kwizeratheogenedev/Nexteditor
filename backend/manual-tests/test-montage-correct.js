import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = __dirname;
const videoA = path.join(tmp, 'test-video1.mp4');
const videoB = path.join(tmp, 'test-video2.mp4');
const videoC = path.join(tmp, 'test-video3.mp4');
const audio = path.join(tmp, 'test-audio.mp3');

function createVideo(output) {
  try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (e) {}
  execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240', '-t', '4', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output], { stdio: 'ignore' });
}

function createAudio(output) {
  try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (e) {}
  execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-q:a', '9', output], { stdio: 'ignore' });
}

async function main() {
  console.log('Creating test media...');
  createVideo(videoA);
  createVideo(videoB);
  createVideo(videoC);
  createAudio(audio);

  console.log('Preparing form data...');
  const form = new FormData();
  form.append('video1', new Blob([fs.readFileSync(videoA)]), 'video1.mp4');
  form.append('video2', new Blob([fs.readFileSync(videoB)]), 'video2.mp4');
  form.append('video3', new Blob([fs.readFileSync(videoC)]), 'video3.mp4');
  form.append('audio', new Blob([fs.readFileSync(audio)]), 'audio.mp3');
  form.append('audioLabel', 'audio.mp3');

  console.log('Sending request to backend on port 3001...');
  const res = await fetch('http://localhost:3001/api/create-montage', {
    method: 'POST',
    body: form,
  });

  console.log('STATUS', res.status);
  const text = await res.text();
  console.log('BODY', text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
