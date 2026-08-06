import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const clipA = path.join(__dirname, 'export-test-fixtures', 'clipA.mp4');
  const clipB = path.join(__dirname, 'export-test-fixtures', 'clipB_noaudio.mp4');

  const timeline = [
    {
      id: 'clip-1',
      sourceId: 'sourceA',
      sourceKind: 'upload',
      trimmedStart: 0.5,
      trimmedEnd: 3,
      transform: { x: 40, y: -20, scaleX: 0.8, scaleY: 0.8, rotation: 5, opacity: 0.9 },
      filters: [{ id: 'color', type: 'color', enabled: true, params: { brightness: 10, contrast: 15, saturation: -10, temperature: 30 } }],
      speed: 1.5,
      volume: 1.2,
      muted: false,
      audioFade: { in: 0.3, out: 0.3 },
    },
    {
      id: 'clip-2',
      sourceId: 'sourceB',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 2,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      filters: [],
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
    },
  ];

  const form = new FormData();
  form.append('timeline', JSON.stringify(timeline));
  form.append('projectName', 'M1 export test');
  form.append('source_sourceA', new Blob([fs.readFileSync(clipA)]), 'clipA.mp4');
  form.append('source_sourceB', new Blob([fs.readFileSync(clipB)]), 'clipB_noaudio.mp4');

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
  console.log('Reported size:', data.size, 'Actual size:', fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 'N/A');
  console.log('Reported duration:', data.duration);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
