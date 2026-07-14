import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const tmp = process.cwd();
const videoA = path.join(tmp, 'test-video1.mp4');
const videoB = path.join(tmp, 'test-video2.mp4');
const videoC = path.join(tmp, 'test-video3.mp4');
const audio = path.join(tmp, 'test-audio.mp3');

function createVideo(output) {
  try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (e) {}
  execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240', '-t', '4', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output], { stdio: 'inherit' });
}

function createAudio(output) {
  try { if (fs.existsSync(output)) fs.unlinkSync(output); } catch (e) {}
  execFileSync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-q:a', '9', output], { stdio: 'inherit' });
}

async function main() {
  console.log('Creating test media...');
  createVideo(videoA);
  createVideo(videoB);
  createVideo(videoC);
  createAudio(audio);

  const form = new FormData();
  form.append('video1', fs.createReadStream(videoA));
  form.append('video2', fs.createReadStream(videoB));
  form.append('video3', fs.createReadStream(videoC));
  form.append('audio', fs.createReadStream(audio));

  const res = await fetch('http://localhost:3000/api/create-montage', {
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
