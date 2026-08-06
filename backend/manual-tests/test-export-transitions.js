import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const clipA = path.join(__dirname, 'export-test-fixtures', 'clipA.mp4');

  // Two 4s clips (same source file, reused under two sourceIds) with a 1s
  // fade transitionOut on the first - exercises the xfade/acrossfade chain
  // in backend/services/filterGraph/effects/transition.js. Expected total
  // output duration: 4 + 4 - 1 = 7s.
  const timeline = [
    {
      id: 'clip-1',
      type: 'video',
      sourceId: 'sourceA',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 4,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      keyframes: { x: [], y: [], rotation: [], opacity: [], volume: [] },
      filters: [],
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
      transitionOut: { type: 'fade', duration: 1 },
    },
    {
      id: 'clip-2',
      type: 'video',
      sourceId: 'sourceB',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 4,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
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
  form.append('projectName', 'M5 transition test');
  form.append('source_sourceA', new Blob([fs.readFileSync(clipA)]), 'clipA.mp4');
  form.append('source_sourceB', new Blob([fs.readFileSync(clipA)]), 'clipA.mp4');

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
  console.log('Reported duration:', data.duration, '(expected 7)');
  const outputPath = path.resolve(__dirname, '..', 'clips', data.fileName);
  console.log('Output file exists:', fs.existsSync(outputPath), outputPath);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
