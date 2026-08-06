import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const red = path.join(__dirname, 'export-test-fixtures', 'pip-red.mp4');
  const blue = path.join(__dirname, 'export-test-fixtures', 'pip-blue.mp4');

  // Lane 0: red, full-frame, 0-4s. Lane 1: blue (with audio), scaled to 50%,
  // centered, active only 1-3s - a picture-in-picture overlay. Exercises
  // M8's overlayTrack.js compositing + the overlay clip's own audio mixing.
  const timeline = [
    {
      id: 'base-red',
      type: 'video',
      trackIndex: 0,
      startTime: 0,
      sourceId: 'sourceRed',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 4,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      keyframes: { x: [], y: [], rotation: [], opacity: [], volume: [] },
      filters: [],
      speed: 1,
      volume: 1,
      muted: true,
      audioFade: { in: 0, out: 0 },
      transitionOut: null,
    },
    {
      id: 'overlay-blue',
      type: 'video',
      trackIndex: 1,
      startTime: 1,
      sourceId: 'sourceBlue',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 2,
      transform: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, rotation: 0, opacity: 1 },
      keyframes: { x: [], y: [], rotation: [], opacity: [], volume: [] },
      filters: [],
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
      transitionOut: null,
    },
  ];

  const form = new FormData();
  form.append('timeline', JSON.stringify(timeline));
  form.append('projectName', 'M8 overlay test');
  form.append('source_sourceRed', new Blob([fs.readFileSync(red)]), 'pip-red.mp4');
  form.append('source_sourceBlue', new Blob([fs.readFileSync(blue)]), 'pip-blue.mp4');

  console.log('POSTing to', `${BASE}/api/editor/export`);
  const response = await fetch(`${BASE}/api/editor/export`, { method: 'POST', body: form });
  const text = await response.text();
  console.log('Status:', response.status);
  console.log('Body:', text);

  if (!response.ok) {
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(text);
  console.log('Reported duration:', data.duration, '(expected 4 - lane 0 alone defines program length)');
  const outputPath = path.resolve(__dirname, '..', 'clips', data.fileName);
  console.log('Output file exists:', fs.existsSync(outputPath), outputPath);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
