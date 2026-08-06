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
      filters: [],
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
    },
    {
      id: 'text-1',
      type: 'text',
      trimmedStart: 0,
      trimmedEnd: 2,
      text: { content: 'Hello NexEditor', fontFamily: 'Inter, sans-serif', fontSize: 80, color: '#ffff00', align: 'center' },
    },
    {
      id: 'text-2',
      type: 'text',
      trimmedStart: 2,
      trimmedEnd: 4,
      text: { content: "It's a test: colon & quote'", fontFamily: 'Inter, sans-serif', fontSize: 60, color: '#00ffff', align: 'left' },
    },
  ];

  const form = new FormData();
  form.append('timeline', JSON.stringify(timeline));
  form.append('projectName', 'M2 text overlay test');
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
