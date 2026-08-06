import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const clipA = path.join(__dirname, 'export-test-fixtures', 'clipA.mp4');

  // One 4s video clip (own audio muted, so the mix is cleanly attributable
  // to the standalone audio-track clip) + one standalone audio-track clip
  // (reusing clipA's audio) with a volume envelope ramping 0.2 -> 1.0 -
  // exercises backend/services/filterGraph/effects/audioTrack.js +
  // volumeEnvelope.js + the amix mixing step in index.js.
  const timeline = [
    {
      id: 'video-1',
      type: 'video',
      sourceId: 'sourceVideo',
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
      id: 'audio-1',
      type: 'audio',
      sourceId: 'sourceAudio',
      sourceKind: 'upload',
      trimmedStart: 0,
      trimmedEnd: 4,
      speed: 1,
      volume: 1,
      muted: false,
      audioFade: { in: 0, out: 0 },
      keyframes: { x: [], y: [], rotation: [], opacity: [], volume: [{ t: 0, value: 0.2 }, { t: 4, value: 1.0 }] },
    },
  ];

  const form = new FormData();
  form.append('timeline', JSON.stringify(timeline));
  form.append('projectName', 'M6 audio track test');
  form.append('source_sourceVideo', new Blob([fs.readFileSync(clipA)]), 'clipA.mp4');
  form.append('source_sourceAudio', new Blob([fs.readFileSync(clipA)]), 'clipA.mp4');

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
  console.log('Reported duration:', data.duration, '(expected 4 - audio track does not extend it)');
  const outputPath = path.resolve(__dirname, '..', 'clips', data.fileName);
  console.log('Output file exists:', fs.existsSync(outputPath), outputPath);
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
