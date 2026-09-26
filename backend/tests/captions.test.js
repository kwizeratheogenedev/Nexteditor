import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildCaptionAss, applyCaptions, FONTS_DIR } from '../services/filterGraph/effects/captionAss.js';
import { buildCaptionAudioGraph } from '../services/filterGraph/captionAudio.js';
import { FilterGraph } from '../services/filterGraph/FilterGraph.js';
import { runFFmpeg } from '../services/ffmpeg.js';

const canvas = { width: 1920, height: 1080, fps: 30 };

function captionClip(overrides = {}, caption = {}) {
  return {
    id: 'c1',
    type: 'text',
    startTime: 10,
    trimmedStart: 0,
    trimmedEnd: 2,
    text: {
      content: 'Hello golden world',
      fontSize: 64,
      color: '#ffffff',
      caption: {
        style: 'karaoke',
        weight: 900,
        highlight: true,
        highlightColor: '#00c8ff',
        outline: 3,
        position: 'lower',
        words: [
          { text: 'Hello', start: 0, end: 0.5 },
          { text: 'golden', start: 0.5, end: 1.1 },
          { text: 'world', start: 1.2, end: 1.8 },
        ],
        ...caption,
      },
      ...overrides,
    },
  };
}

test('the bundled Inter weights are present', () => {
  ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'Inter-Black.ttf', 'OFL.txt'].forEach((file) => {
    assert.ok(fs.existsSync(path.join(FONTS_DIR, file)), `${file} missing`);
  });
});

test('karaoke: one event per word, the spoken word in the highlight colour', () => {
  const ass = buildCaptionAss([captionClip()], canvas);
  assert.match(ass, /PlayResX: 1920/);
  assert.match(ass, /Style: C0,Inter Black,77,/, 'font picked by weight, size scaled for libass');
  const events = ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
  assert.equal(events.length, 3);
  assert.match(events[0], /0:00:10\.00,0:00:10\.50/);
  assert.match(events[0], /\{\\c&HFFC800&\}Hello\{\\r\} golden world/);
  assert.match(events[1], /Hello \{\\c&HFFC800&\}golden\{\\r\} world/);
  assert.match(events[2], /0:00:11\.20,0:00:12\.00/, 'last word holds to the end of the clip');
});

test('plain styles are a single event; box, uppercase and pop are honoured', () => {
  const subtitle = buildCaptionAss([captionClip({}, { style: 'subtitle', highlight: false, box: true, weight: 600 })], canvas);
  const style = subtitle.split('\n').find((line) => line.startsWith('Style: C0'));
  assert.match(style, /Inter SemiBold/);
  assert.equal(style.split(',')[15], '3', 'BorderStyle 3 = opaque box');
  assert.equal(subtitle.split('\n').filter((line) => line.startsWith('Dialogue:')).length, 1);

  const bold = buildCaptionAss([captionClip({}, { style: 'bold', highlight: false, uppercase: true, pop: true })], canvas);
  assert.match(bold, /\{\\fscx82\\fscy82\\t\(0,140,\\fscx100\\fscy100\)\}HELLO GOLDEN WORLD/);
});

test('caption text can never inject ASS markup', () => {
  const ass = buildCaptionAss([captionClip({ content: 'a {\\b1} b' }, { highlight: false, words: [] })], canvas);
  const event = ass.split('\n').find((line) => line.startsWith('Dialogue:'));
  assert.doesNotMatch(event, /\{\\b1\}/);
  assert.match(event, /a \(.b1\) b/);
});

test('positions map to bottom, middle and top', () => {
  const alignmentOf = (position) => buildCaptionAss([captionClip({}, { position })], canvas).split('\n').find((l) => l.startsWith('Style: C0')).split(',')[18];
  assert.deepEqual(['lower', 'middle', 'top'].map(alignmentOf), ['2', '5', '8']);
});

test('the caption audio graph mixes every sounding clip at its own start time', () => {
  const clips = [
    { id: 'v', type: 'video', sourceId: 's1', startTime: 0, trimmedStart: 0, trimmedEnd: 5 },
    { id: 'a', type: 'audio', sourceId: 's2', startTime: 3, trimmedStart: 0, trimmedEnd: 10 },
    { id: 'm', type: 'video', sourceId: 's3', startTime: 1, trimmedStart: 0, trimmedEnd: 2, muted: true },
  ];
  const graph = buildCaptionAudioGraph(clips, new Map([['v', 0], ['a', 1], ['m', 2]]), new Map([['s1', true], ['s2', true], ['s3', true]]));
  assert.match(graph.filterComplex, /\[0:a\]/);
  assert.match(graph.filterComplex, /adelay=3000/);
  assert.doesNotMatch(graph.filterComplex, /\[2:a\]/, 'muted clips are left out');
  assert.match(graph.filterComplex, /amix=inputs=2/);
  assert.equal(buildCaptionAudioGraph(clips, new Map(), new Map()), null);
});

test('a real ffmpeg render draws the captions with the bundled fonts', async () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nex-captions-'));
  try {
    const graph = new FilterGraph();
    const label = applyCaptions(graph, '0:v', [captionClip({}, { words: [{ text: 'Hello', start: 0, end: 1 }] })], { width: 640, height: 360 }, jobDir);
    const out = path.join(jobDir, 'frame.png');
    await runFFmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=12', '-filter_complex', graph.build(), '-map', `[${label}]`, '-ss', '10.2', '-frames:v', '1', '-update', '1', out], { timeout: 30000 });
    assert.ok(fs.statSync(out).size > 1000, 'frame rendered');
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
});

test('the captions endpoint requires sign-in', async () => {
  const { default: router } = await import('../routes/editorCaptions.js');
  const app = express();
  app.use(express.json());
  app.use('/api/editor/captions', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/editor/captions`, { method: 'POST' });
    assert.equal(res.status, 401);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
