import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const clipA = path.join(__dirname, 'export-test-fixtures', 'clipA.mp4');

  const timeline = [
    {
      id: 'clip-1',
      type: 'video',
      sourceId: 'sourceA',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 4,
      transform: { x: 0, y: 0, scaleX: 0.6, scaleY: 0.6, rotation: 0, opacity: 1 },
      keyframes: {
        x: [{ t: 0, value: -400 }, { t: 4, value: 400 }],
        y: [],
        rotation: [{ t: 0, value: 0 }, { t: 2, value: 180 }, { t: 4, value: 360 }],
        opacity: [{ t: 0, value: 0.1 }, { t: 2, value: 1 }, { t: 4, value: 0.1 }],
      },
      filters: [],
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
    },
  ];

  const form = new FormData();
  form.append('timeline', JSON.stringify(timeline));
  form.append('projectName', 'M3 keyframe test');
  form.append('source_sourceA', new Blob([fs.readFileSync(clipA)]), 'clipA.mp4');

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
  const outputPath = path.resolve(__dirname, '..', 'clips', data.fileName);
  console.log('Output file exists:', fs.existsSync(outputPath), outputPath);
  console.log('Reported duration:', data.duration);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
