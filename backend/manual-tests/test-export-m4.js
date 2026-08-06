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
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      keyframes: { x: [], y: [], rotation: [], opacity: [] },
      filters: [
        { id: 'color', type: 'color', enabled: true, params: { brightness: -5, contrast: 30, saturation: -100, temperature: 0 } }, // 'noir' preset
        { id: 'vignette', type: 'vignette', enabled: true, params: { intensity: 80 } },
      ],
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
    },
  ];

  const form = new FormData();
  form.append('timeline', JSON.stringify(timeline));
  form.append('projectName', 'M4 color+vignette test');
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
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
