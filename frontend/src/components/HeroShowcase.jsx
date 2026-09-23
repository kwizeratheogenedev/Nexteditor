import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './HeroShowcase.css';

/*
 * HeroShowcase — an animated, code-driven "product video" for the landing
 * hero. Every frame is a pure function of time `t`, so it can autoplay,
 * pause, be scrubbed, jump to a chapter, and be rendered frame-by-frame to
 * an MP4 (see renderTime prop). No video file needed; it stays crisp at any
 * size because the 1280x720 stage is scaled with a CSS transform.
 *
 * Props
 *   videoSrc   optional URL of a real recorded MP4 — if given, it's shown
 *              instead of the animated demo (poster = optional still).
 *   controls   show the play/pause + chapter bar (default true).
 *   renderTime controlled time in seconds (for frame capture). When set, the
 *              internal clock and controls are disabled.
 */

const BRAND_A = 'Nex';
const BRAND_B = 'Editor';
const W = 1280;
const H = 720;

export const SCENES = (() => {
  const list = [
    { id: 'import', label: 'Import from anywhere', short: 'Import', dur: 4.5, tab: 'media' },
    { id: 'timeline', label: 'Multi-track timeline', short: 'Timeline', dur: 5, tab: 'edit' },
    { id: 'effects', label: 'Color, keyframes & transitions', short: 'Effects', dur: 5.5, tab: 'edit' },
    { id: 'montage', label: 'Beat-synced montage', short: 'Montage', dur: 4.5, tab: 'montage' },
    { id: 'captions', label: 'Auto captions', short: 'Captions', dur: 5, tab: 'captions' },
    { id: 'shorts', label: 'One-click Shorts', short: 'Shorts', dur: 4.5, tab: 'shorts' },
    { id: 'export', label: 'Export & auto-save', short: 'Export', dur: 4.5, tab: 'edit' },
    { id: 'outro', label: '', short: '', dur: 2.5, tab: 'edit', hidden: true },
  ];
  let s = 0;
  return list.map((sc, i) => {
    const out = { ...sc, index: i, start: s };
    s += sc.dur;
    return out;
  });
})();
export const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0);
const CHAPTERS = SCENES.filter((s) => !s.hidden);

/* ---------- math helpers ---------- */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eo = (x) => 1 - Math.pow(1 - x, 3);
const lerp = (a, b, x) => a + (b - a) * x;
const fmt = (s) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
const fmtTC = (s) => {
  const f = Math.floor((s % 1) * 30);
  return `${fmt(s)}:${String(f).padStart(2, '0')}`;
};
/** Cursor path: pts = [[p, x, y, down]] */
function cursorAt(p, pts) {
  if (p <= pts[0][0]) return { x: pts[0][1], y: pts[0][2], down: !!pts[0][3] };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (p <= b[0]) {
      const k = ease(seg(p, a[0], b[0]));
      return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), down: !!(a[3] && b[3]) || (k === 0 && !!a[3]) };
    }
  }
  const l = pts[pts.length - 1];
  return { x: l[1], y: l[2], down: !!l[3] };
}

/* ---------- layout constants (stage px) ---------- */
const PV = { x: 364, y: 62, w: 620, h: 349 }; // preview video box
const TL_Y = 452;
const TX0 = 150;
const TX1 = 1262;
const PXS = (TX1 - TX0) / 30; // px per second
const tx = (s) => TX0 + s * PXS;
const TRACK_Y0 = TL_Y + 56;
const TRACK_H = 44;
const trackY = (i) => TRACK_Y0 + i * (TRACK_H + 2);
const TRACKS = [
  { id: 'T1', label: 'Text', kind: 'text' },
  { id: 'V2', label: 'Overlay', kind: 'video' },
  { id: 'V1', label: 'Main', kind: 'video' },
  { id: 'A1', label: 'Music', kind: 'audio' },
];
const BPM = 124;
const BEAT = 60 / BPM;

/* ---------- footage (stylised, procedurally drawn clips) ---------- */
const PAL = {
  sunset: { sky: ['#ffb36b', '#ff6f7d', '#5a2d82'], sun: '#ffe6a3', far: '#8a3f7c', near: '#2b1638', sunY: 0.58 },
  ocean: { sky: ['#c9ecff', '#62b3ea', '#1f5fa0'], sun: '#fffbe0', far: '#2d77b8', near: '#0f3a66', sunY: 0.3 },
  city: { sky: ['#241a5c', '#5a2f8f', '#f06a9a'], sun: '#ffd0e0', far: '#3a2466', near: '#140d2e', sunY: 0.72 },
  forest: { sky: ['#e2f7e6', '#8ccfa4', '#3d8a64'], sun: '#fffbe8', far: '#2f7a58', near: '#123d2c', sunY: 0.26 },
};
const VARIANTS = ['sunset', 'ocean', 'city', 'forest'];
const MEDIA_NAMES = { sunset: 'golden-hour.mp4', ocean: 'coastline.mp4', city: 'night-drive.mp4', forest: 'trail-run.mp4' };

function ridge(base, amp, freq, phase, shift) {
  let d = `M -10 90 L -10 ${base}`;
  for (let x = -10; x <= 170; x += 6) {
    const y = base + amp * Math.sin(x * freq + phase + shift) + amp * 0.45 * Math.sin(x * freq * 2.7 + phase * 1.7 + shift * 1.3);
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return `${d} L 170 90 Z`;
}

export function subjectX(time) {
  return 0.6 + 0.12 * Math.sin(time * 0.9);
}

const Footage = memo(function Footage({ variant = 'sunset', time = 0, subject = false }) {
  const uid = useId().replace(/:/g, '');
  const c = PAL[variant];
  const shift = time * 0.18;
  const sx = subjectX(time) * 160;
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" className="hs-footage" aria-hidden="true">
      <defs>
        <linearGradient id={`sky${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.sky[2]} />
          <stop offset="0.55" stopColor={c.sky[1]} />
          <stop offset="1" stopColor={c.sky[0]} />
        </linearGradient>
        <radialGradient id={`glow${uid}`}>
          <stop offset="0" stopColor={c.sun} stopOpacity="0.9" />
          <stop offset="1" stopColor={c.sun} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="160" height="90" fill={`url(#sky${uid})`} />
      <circle cx={98 - shift * 2} cy={c.sunY * 90} r="34" fill={`url(#glow${uid})`} />
      <circle cx={98 - shift * 2} cy={c.sunY * 90} r="9" fill={c.sun} />
      {variant === 'city' ? (
        <g fill={c.near}>
          {Array.from({ length: 16 }).map((_, i) => {
            const bw = 7 + ((i * 37) % 6);
            const bh = 18 + ((i * 53) % 34);
            const x = ((i * 11 - shift * 6) % 176) - 8;
            return (
              <g key={i}>
                <rect x={x} y={90 - bh} width={bw} height={bh} />
                {i % 2 === 0 && <rect x={x + 2} y={90 - bh + 4} width="1.6" height="1.6" fill="#ffd27a" opacity="0.8" />}
              </g>
            );
          })}
        </g>
      ) : (
        <>
          <path d={ridge(58, 6, 0.05, 1, shift)} fill={c.far} opacity="0.85" />
          {variant === 'ocean' ? (
            <>
              <rect y="62" width="160" height="28" fill={c.near} />
              {[66, 71, 77, 83].map((y, i) => (
                <path key={y} d={ridge(y, 0.8, 0.22, i, shift * 4)} fill="none" stroke="#ffffff" strokeOpacity={0.25 - i * 0.04} strokeWidth="0.6" />
              ))}
            </>
          ) : (
            <path d={ridge(70, 7, 0.035, 2.2, shift * 1.8)} fill={c.near} />
          )}
          {variant === 'forest' &&
            Array.from({ length: 12 }).map((_, i) => {
              const x = ((i * 15 - shift * 10) % 180) - 10;
              return <path key={i} d={`M ${x} 90 L ${x + 5} ${66 - (i % 3) * 5} L ${x + 10} 90 Z`} fill="#0c2a1e" />;
            })}
        </>
      )}
      {subject && (
        <g fill="#1a0c24" transform={`translate(${sx} 0)`}>
          <circle cx="0" cy="55" r="2.6" />
          <path d="M -3 59 Q 0 57 3 59 L 3.6 72 L 1.4 72 L 0.6 84 L -0.6 84 L -1.4 72 L -3.6 72 Z" />
        </g>
      )}
    </svg>
  );
});

const Waveform = memo(function Waveform({ width, height, color = '#7ad8a0', seconds = 28 }) {
  const bars = [];
  const n = Math.floor(width / 3);
  for (let i = 0; i < n; i++) {
    const s = (i / n) * seconds;
    const beatPhase = (s % BEAT) / BEAT;
    const env = 0.35 + 0.65 * Math.exp(-beatPhase * 5);
    const noise = 0.5 + 0.5 * Math.sin(i * 12.9898) * Math.sin(i * 0.37);
    const h = Math.max(2, height * (0.18 + 0.72 * env * (0.6 + 0.4 * noise)));
    bars.push(<rect key={i} x={i * 3} y={(height - h) / 2} width="2" height={h} rx="1" />);
  }
  return (
    <svg width={width} height={height} className="hs-wave" aria-hidden="true">
      <g fill={color}>{bars}</g>
    </svg>
  );
});

/* ---------- icons ---------- */
const I = {
  media: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5',
  edit: 'M3 7h18 M3 12h18 M3 17h18 M8 4v6 M15 9v6 M11 14v6',
  montage: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  captions: 'M3 5h18v14H3z M7 13h4 M13 13h4 M7 16h10',
  shorts: 'M8 3h8v18H8z M11 18h2',
  mix: 'M4 12h3l2-6 3 12 3-9 2 3h3',
  projects: 'M3 7h7l2 2h9v10H3z',
  split: 'M12 3v18 M5 8l-2 4 2 4 M19 8l2 4-2 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4 M6 8h4 M14 8h4',
  undo: 'M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7z M14 4h4v16h-4z',
  check: 'M5 12l5 5 9-10',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5 4.3 4.3 0 0 0 7 18z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  lock: 'M6 11h12v9H6z M9 11V8a3 3 0 0 1 6 0v3',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z',
  diamond: 'M12 3l9 9-9 9-9-9z',
};
function Icon({ d, size = 16, stroke = 'currentColor', fill = 'none', sw = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* ---------- scene state ---------- */
function makeV1(trim) {
  const d = trim; // 0..1 second removed from clip 2 (ripple)
  return [
    { s: 0, e: 6, v: 'sunset' },
    { s: 6, e: 13 - d, v: 'ocean' },
    { s: 13 - d, e: 21 - d, v: 'city' },
    { s: 21 - d, e: 28 - d, v: 'forest' },
  ].map((c) => ({ ...c, r: 1 }));
}
const V2 = [{ s: 8, e: 12, v: 'city', label: 'B-roll' }];
const T1 = [
  { s: 1, e: 7, label: 'Title · Golden hour' },
  { s: 15, e: 20, label: 'Lower third' },
];
const MONTAGE_CUT = BEAT * 8;
const MONTAGE = Array.from({ length: 7 }).map((_, i) => ({
  s: i * MONTAGE_CUT,
  e: (i + 1) * MONTAGE_CUT,
  v: VARIANTS[(i * 3) % 4],
}));
const CAPTION_WORDS = ['Edit', 'like', 'a', 'pro,', 'right', 'in', 'your', 'browser.'];
const TRANSCRIPT = [
  ['00:00', 'Edit like a pro,'],
  ['00:02', 'right in your browser.'],
  ['00:05', 'Cut, grade and caption'],
  ['00:08', 'then export in one click.'],
];

function computeState(t) {
  let sc = SCENES[SCENES.length - 1];
  for (const s of SCENES) if (t >= s.start && t < s.start + s.dur) sc = s;
  const p = clamp((t - sc.start) / sc.dur);
  const st = {
    scene: sc,
    p,
    time: t,
    tab: sc.tab,
    playhead: 0,
    v1: makeV1(1),
    v2: V2.map((c) => ({ ...c, r: 1 })),
    t1: T1.map((c) => ({ ...c, r: 1 })),
    a1r: 1,
    tiles: 5,
    tileR: [1, 1, 1, 1, 1, 1],
    ytTile: 1,
    url: null,
    fetchProg: 0,
    drag: null,
    previewEmpty: false,
    grade: { sat: 1, hue: 0, bri: 1, con: 1 },
    wipe: null,
    zoom: 1,
    keyframes: [],
    transition: 0,
    inspector: 'clip',
    selected: null,
    speedDraw: 0,
    beats: 0,
    montage: 0,
    bpm: 0,
    flash: 0,
    captions: null,
    shorts: 0,
    moments: 0,
    exportModal: 0,
    exportProg: 0,
    exportDone: 0,
    outro: 0,
    snap: 0,
    trimHandle: null,
    saving: false,
    cursor: { x: 700, y: 300, down: false },
    cursorVis: 1,
    pressed: null,
  };

  switch (sc.id) {
    case 'import': {
      st.v1 = makeV1(0).map((c, i) => ({ ...c, r: i === 0 ? eo(seg(p, 0.86, 0.95)) : 0 }));
      st.v2 = st.v2.map((c) => ({ ...c, r: 0 }));
      st.t1 = st.t1.map((c) => ({ ...c, r: 0 }));
      st.a1r = 0;
      st.tileR = [0, 1, 2, 3, 4].map((i) => eo(seg(p, 0.02 + i * 0.05, 0.12 + i * 0.05)));
      const typed = 'youtu.be/afro-house-mix';
      const k = seg(p, 0.32, 0.5);
      st.url = p > 0.28 ? typed.slice(0, Math.round(k * typed.length)) : '';
      st.fetchProg = seg(p, 0.52, 0.62);
      st.ytTile = eo(seg(p, 0.6, 0.66));
      st.previewEmpty = st.v1[0].r < 0.5;
      st.inspector = st.previewEmpty ? 'empty' : 'clip';
      st.selected = st.previewEmpty ? null : 0;
      st.cursor = cursorAt(p, [
        [0, 660, 300],
        [0.26, 250, 108],
        [0.29, 250, 108, 1],
        [0.3, 250, 108],
        [0.5, 250, 108],
        [0.52, 305, 108],
        [0.53, 305, 108, 1],
        [0.55, 305, 108],
        [0.7, 139, 171],
        [0.72, 139, 171, 1],
        [0.88, tx(0) + 70, trackY(2) + 22, 1],
        [0.9, tx(0) + 70, trackY(2) + 22],
        [1, 640, 380],
      ]);
      if (p > 0.72 && p < 0.9) st.drag = { x: st.cursor.x, y: st.cursor.y, v: 'sunset' };
      break;
    }
    case 'timeline': {
      const order = [
        ['v1', 1], ['v1', 2], ['v1', 3], ['a1', 0], ['v2', 0], ['t1', 0], ['t1', 1],
      ];
      const trimK = ease(seg(p, 0.55, 0.75));
      st.v1 = makeV1(trimK);
      st.v2 = st.v2.map((c) => ({ ...c, r: 0 }));
      st.t1 = st.t1.map((c) => ({ ...c, r: 0 }));
      order.forEach(([tr, i], n) => {
        const r = eo(seg(p, 0.02 + n * 0.045, 0.12 + n * 0.045));
        if (tr === 'v1') st.v1[i].r = r;
        else if (tr === 'a1') st.a1r = r;
        else st[tr][i].r = r;
      });
      st.playhead = lerp(0, 10.5, seg(p, 0.05, 1));
      st.selected = 1;
      st.snap = p > 0.72 && p < 0.86 ? 1 - seg(p, 0.78, 0.86) : 0;
      st.trimHandle = p > 0.45 && p < 0.82 ? 1 : 0;
      const hx = tx(13 - trimK);
      st.cursor = cursorAt(p, [
        [0, 640, 380],
        [0.48, tx(13), trackY(2) + 22],
        [0.55, tx(13), trackY(2) + 22, 1],
        [0.75, tx(12), trackY(2) + 22, 1],
        [0.8, tx(12), trackY(2) + 22],
        [1, 900, 300],
      ]);
      if (p > 0.55 && p < 0.75) st.cursor.x = hx;
      break;
    }
    case 'effects': {
      st.playhead = lerp(2.2, 4.2, p);
      const g = ease(seg(p, 0.1, 0.4));
      st.grade = { sat: lerp(1, 1.45, g), hue: lerp(0, -10, g), bri: lerp(1, 1.06, g), con: lerp(1, 1.12, g) };
      st.gradeK = g;
      st.wipe = p > 0.08 && p < 0.56 ? lerp(0.15, 0.85, ease(seg(p, 0.12, 0.52))) : null;
      st.inspector = p < 0.72 ? 'color' : 'speed';
      st.selected = 0;
      st.keyframes = [1, 3, 5].map((k, i) => ({ t: k, r: eo(seg(p, 0.5 + i * 0.05, 0.56 + i * 0.05)) }));
      st.zoom = 1 + 0.1 * ease(seg(p, 0.55, 1));
      st.transition = eo(seg(p, 0.62, 0.7));
      st.speedDraw = ease(seg(p, 0.76, 0.96));
      const k0 = 1020 + 0.5 * 242;
      const k1 = 1020 + 0.78 * 242;
      st.cursor = cursorAt(p, [
        [0, 800, 300],
        [0.08, k0, 246],
        [0.1, k0, 246, 1],
        [0.4, k1, 246, 1],
        [0.43, k1, 246],
        [0.6, tx(6), trackY(2) + 22],
        [0.62, tx(6), trackY(2) + 22, 1],
        [0.66, tx(6), trackY(2) + 22],
        [1, 1120, 380],
      ]);
      break;
    }
    case 'montage': {
      st.beats = seg(p, 0.08, 0.35);
      st.bpm = eo(seg(p, 0.16, 0.24));
      st.montage = seg(p, 0.38, 0.62);
      st.v2 = st.v2.map((c) => ({ ...c, r: 0 }));
      st.t1 = st.t1.map((c) => ({ ...c, r: 0 }));
      st.playhead = lerp(0, 13, seg(p, 0.6, 1));
      if (st.montage > 0.99) {
        const d = st.playhead % MONTAGE_CUT;
        st.flash = st.playhead > 0.2 ? Math.max(0, 1 - d / 0.25) : 0;
      }
      st.inspector = 'montage';
      st.cursor = cursorAt(p, [
        [0, 640, 380],
        [0.3, 204, 368],
        [0.33, 204, 368, 1],
        [0.36, 204, 368],
        [1, 520, 420],
      ]);
      st.pressed = p > 0.33 && p < 0.36 ? 'sync' : null;
      break;
    }
    case 'captions': {
      const gen = seg(p, 0.14, 0.3);
      st.captions = {
        generating: p > 0.14 && p < 0.3,
        gen,
        lines: seg(p, 0.3, 0.55),
        word: p > 0.32 ? Math.floor(seg(p, 0.34, 0.96) * CAPTION_WORDS.length) : -1,
        wordP: (seg(p, 0.34, 0.96) * CAPTION_WORDS.length) % 1,
      };
      st.playhead = lerp(0, 5, seg(p, 0.32, 1));
      st.inspector = 'caption';
      st.cursor = cursorAt(p, [
        [0, 640, 380],
        [0.1, 204, 163],
        [0.13, 204, 163, 1],
        [0.16, 204, 163],
        [0.5, 204, 163],
        [1, 780, 250],
      ]);
      st.pressed = p > 0.13 && p < 0.16 ? 'gen' : null;
      break;
    }
    case 'shorts': {
      st.shorts = ease(seg(p, 0.12, 0.4));
      st.v2 = st.v2.map((c) => ({ ...c, r: 0 }));
      st.moments = seg(p, 0.5, 0.75);
      st.playhead = lerp(1, 5, p);
      st.inspector = 'shorts';
      st.cursor = cursorAt(p, [
        [0, 640, 380],
        [0.07, 1172, 130],
        [0.1, 1172, 130, 1],
        [0.12, 1172, 130],
        [0.44, 204, 113],
        [0.47, 204, 113, 1],
        [0.5, 204, 113],
        [1, 640, 300],
      ]);
      st.pressed = p > 0.47 && p < 0.5 ? 'find' : null;
      break;
    }
    case 'export': {
      st.playhead = 3;
      st.exportModal = eo(seg(p, 0.08, 0.16)) * (1 - eo(seg(p, 0.94, 1)));
      st.exportProg = ease(seg(p, 0.3, 0.8));
      st.exportDone = eo(seg(p, 0.8, 0.86));
      st.saving = p > 0.82;
      st.cursor = cursorAt(p, [
        [0, 800, 300],
        [0.05, 1231, 22],
        [0.07, 1231, 22, 1],
        [0.09, 1231, 22],
        [0.25, 795, 436],
        [0.27, 795, 436, 1],
        [0.29, 795, 436],
        [1, 900, 560],
      ]);
      st.pressed = p > 0.05 && p < 0.09 ? 'topExport' : p > 0.27 && p < 0.29 ? 'export' : null;
      break;
    }
    case 'outro': {
      st.playhead = 3;
      st.outro = eo(seg(p, 0, 0.25)) * (1 - seg(p, 0.85, 1));
      st.cursorVis = 1 - seg(p, 0, 0.2);
      st.cursor = { x: 900, y: 560, down: false };
      break;
    }
    default:
  }
  if (sc.id !== 'outro' && sc.id !== 'import') st.cursorVis = 1;
  if (sc.id === 'import') st.cursorVis = seg(p, 0, 0.05);
  return st;
}

/* ---------- stage pieces ---------- */
function TopBar({ st }) {
  const ch = CHAPTERS.findIndex((c) => c.id === st.scene.id);
  return (
    <div className="hs-topbar">
      <div className="hs-brand">
        <span>{BRAND_A}</span>
        <span className="hs-accent">{BRAND_B}</span>
      </div>
      <div className="hs-project">
        Golden Hour — Promo
        <span className={`hs-saved ${st.saving ? 'on' : ''}`}>
          <Icon d={I.cloud} size={13} /> {st.saving ? 'Saved to cloud' : 'Saved'}
        </span>
      </div>
      {ch >= 0 && (
        <div className="hs-chapter" style={{ opacity: eo(seg(st.p, 0, 0.1)), transform: `translateX(-50%) translateY(${(1 - eo(seg(st.p, 0, 0.1))) * -6}px)` }}>
          <b>{String(ch + 1).padStart(2, '0')}</b>
          <span>{st.scene.label}</span>
        </div>
      )}
      <div className="hs-top-right">
        <span className="hs-pill">16:9 · 1080p</span>
        <span className={`hs-export-btn ${st.pressed === 'topExport' ? 'pressed' : ''}`}>Export</span>
      </div>
    </div>
  );
}

const SIDE = [
  ['media', 'Media', I.media],
  ['edit', 'Edit', I.edit],
  ['montage', 'Montage', I.montage],
  ['captions', 'Captions', I.captions],
  ['shorts', 'Shorts', I.shorts],
  ['mix', 'Long Mix', I.mix],
  ['projects', 'Projects', I.projects],
];
function Sidebar({ st }) {
  return (
    <div className="hs-sidebar">
      {SIDE.map(([id, label, d]) => (
        <div key={id} className={`hs-side-item ${st.tab === id ? 'active' : ''}`}>
          <Icon d={d} size={18} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function MediaPanel({ st }) {
  const tiles = VARIANTS.map((v) => ({ v, name: MEDIA_NAMES[v] }));
  return (
    <div className="hs-left">
      <div className="hs-panel-head">
        <span>Media</span>
        <span className="hs-mini-btn">+ Import</span>
      </div>
      <div className={`hs-url ${st.url !== null && st.url !== undefined && st.scene.id === 'import' && st.p > 0.27 ? 'focus' : ''}`}>
        <Icon d={I.link} size={13} />
        <span className="hs-url-text">
          {st.url ? st.url : <em>Paste a YouTube, TikTok or Drive link</em>}
          {st.scene.id === 'import' && st.p > 0.28 && st.p < 0.52 && <i className="hs-caret" />}
        </span>
        <span className={`hs-url-go ${st.scene.id === 'import' && st.p > 0.53 && st.p < 0.55 ? 'pressed' : ''}`}>Fetch</span>
        {st.fetchProg > 0 && st.fetchProg < 1 && <span className="hs-url-bar" style={{ width: `${st.fetchProg * 100}%` }} />}
      </div>
      <div className="hs-tiles">
        {tiles.map((tile, i) => (
          <div
            key={tile.v}
            className={`hs-tile ${st.selected === 0 && i === 0 && st.tab === 'media' ? 'sel' : ''}`}
            style={{ opacity: st.tileR[i], transform: `translateY(${(1 - st.tileR[i]) * 10}px) scale(${0.94 + 0.06 * st.tileR[i]})` }}
          >
            <div className="hs-tile-img">
              <Footage variant={tile.v} time={0} subject={tile.v === 'sunset'} />
              <span className="hs-tile-dur">{['0:06', '0:07', '0:08', '0:07'][i]}</span>
            </div>
            <span className="hs-tile-name">{tile.name}</span>
          </div>
        ))}
        <div className="hs-tile" style={{ opacity: st.tileR[4] }}>
          <div className="hs-tile-img hs-tile-audio">
            <Waveform width={110} height={34} seconds={6} />
          </div>
          <span className="hs-tile-name">afro-house-mix.mp3</span>
        </div>
        <div className="hs-tile" style={{ opacity: st.ytTile, transform: `scale(${0.9 + 0.1 * st.ytTile})` }}>
          <div className="hs-tile-img">
            <Footage variant="city" time={3} />
            <span className="hs-tile-badge">From link</span>
          </div>
          <span className="hs-tile-name">night-drive-4k.mp4</span>
        </div>
      </div>
    </div>
  );
}

function MontagePanel({ st }) {
  return (
    <div className="hs-left">
      <div className="hs-panel-head">
        <span>Montage</span>
        <span className="hs-tag">Auto</span>
      </div>
      <div className="hs-field">
        <label>Soundtrack</label>
        <div className="hs-box">
          <Icon d={I.montage} size={13} /> afro-house-mix.mp3
        </div>
      </div>
      <div className="hs-bpm" style={{ opacity: st.bpm, transform: `scale(${0.85 + 0.15 * st.bpm})` }}>
        <span className="hs-bpm-dot" /> {BPM} BPM detected · 4/4
      </div>
      <div className="hs-field">
        <label>Cut on</label>
        <div className="hs-seg">
          <span>Beat</span>
          <span className="on">Bar</span>
          <span>Drop</span>
        </div>
      </div>
      <div className="hs-field">
        <label>Clips</label>
        <div className="hs-chips">
          {VARIANTS.map((v) => (
            <span key={v} className="hs-chip-thumb">
              <Footage variant={v} time={0} />
            </span>
          ))}
        </div>
      </div>
      <div className={`hs-cta ${st.pressed === 'sync' ? 'pressed' : ''}`}>
        <Icon d={I.sparkle} size={14} /> {st.montage > 0 ? (st.montage < 1 ? 'Syncing to beat…' : '7 cuts synced') : 'Auto-sync to beat'}
      </div>
    </div>
  );
}

function CaptionsPanel({ st }) {
  const c = st.captions || {};
  return (
    <div className="hs-left">
      <div className="hs-panel-head">
        <span>Captions</span>
        <span className="hs-tag">AI</span>
      </div>
      <div className="hs-field" style={{ marginTop: 6 }}>
        <label>Language</label>
        <div className="hs-lang">
          {['English', 'Français', 'Kiswahili', 'Kinyarwanda'].map((l, i) => (
            <span key={l} className={i === 0 ? 'on' : ''}>
              {l}
            </span>
          ))}
        </div>
      </div>
      <div className={`hs-cta static ${st.pressed === 'gen' ? 'pressed' : ''}`}>
        {c.generating ? (
          <>
            <span className="hs-spin" style={{ transform: `rotate(${st.time * 540}deg)` }} /> Transcribing… {Math.round(c.gen * 100)}%
          </>
        ) : c.lines > 0 ? (
          <>
            <Icon d={I.check} size={14} /> 4 captions generated
          </>
        ) : (
          <>
            <Icon d={I.sparkle} size={14} /> Generate captions
          </>
        )}
      </div>
      <div className="hs-transcript">
        {TRANSCRIPT.map(([tc, txt], i) => {
          const r = eo(seg(c.lines || 0, i * 0.22, i * 0.22 + 0.3));
          const active = c.word >= 0 && Math.floor((c.word / CAPTION_WORDS.length) * 2) === i;
          return (
            <div key={tc} className={`hs-line ${active ? 'active' : ''}`} style={{ opacity: r, transform: `translateX(${(1 - r) * -12}px)` }}>
              <span>{tc}</span>
              {txt}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShortsPanel({ st }) {
  const cards = [
    { v: 'sunset', t: '00:02 – 00:31', score: 94 },
    { v: 'city', t: '01:12 – 01:40', score: 88 },
    { v: 'ocean', t: '02:05 – 02:33', score: 81 },
  ];
  return (
    <div className="hs-left">
      <div className="hs-panel-head">
        <span>Shorts</span>
        <span className="hs-tag">9:16</span>
      </div>
      <div className={`hs-cta static ${st.pressed === 'find' ? 'pressed' : ''}`} style={{ marginTop: 4 }}>
        <Icon d={I.sparkle} size={14} /> {st.moments > 0 ? '3 best moments found' : 'Find best moments'}
      </div>
      <div className="hs-cards">
        {cards.map((c, i) => {
          const r = eo(seg(st.moments, i * 0.25, i * 0.25 + 0.4));
          return (
            <div key={c.v} className="hs-card" style={{ opacity: r, transform: `translateY(${(1 - r) * 12}px)` }}>
              <div className="hs-card-thumb">
                <Footage variant={c.v} time={i} subject={c.v === 'sunset'} />
              </div>
              <div className="hs-card-body">
                <b>Moment #{i + 1}</b>
                <span>{c.t}</span>
                <div className="hs-score">
                  <i style={{ width: `${c.score * r}%` }} />
                </div>
                <em>Hook score {c.score}</em>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Slider({ label, value, display, highlight }) {
  return (
    <div className={`hs-slider ${highlight ? 'hl' : ''}`}>
      <div className="hs-slider-top">
        <span>{label}</span>
        <b>{display}</b>
      </div>
      <div className="hs-track">
        <i style={{ width: `${value * 100}%` }} />
        <span style={{ left: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function Inspector({ st }) {
  let body = null;
  let title = 'Inspector';
  if (st.inspector === 'empty') {
    body = <div className="hs-empty">Select a clip to edit its properties</div>;
  } else if (st.inspector === 'clip') {
    const c = st.v1[st.selected ?? 0] || st.v1[0];
    title = MEDIA_NAMES[c.v];
    body = (
      <>
        <div className="hs-props">
          <span>Duration</span>
          <b>{(c.e - c.s).toFixed(2)}s</b>
          <span>Start</span>
          <b>{fmtTC(c.s)}</b>
          <span>Track</span>
          <b>V1 · Main</b>
        </div>
        <Slider label="Scale" value={0.5} display="100%" />
        <Slider label="Opacity" value={1} display="100%" />
        <Slider label="Volume" value={0.7} display="-3 dB" />
        <Slider label="Speed" value={0.33} display="1.0×" />
      </>
    );
  } else if (st.inspector === 'color') {
    const k = st.gradeK || 0;
    title = 'Color';
    body = (
      <>
        <div className="hs-presets">
          {['Natural', 'Warm film', 'Teal & orange', 'Mono'].map((n, i) => (
            <span key={n} className={i === 1 && k > 0.5 ? 'on' : ''}>
              {n}
            </span>
          ))}
        </div>
        <Slider label="Exposure" value={lerp(0.5, 0.58, k)} display={`+${(k * 0.3).toFixed(2)}`} />
        <Slider label="Contrast" value={lerp(0.5, 0.62, k)} display={`+${Math.round(k * 12)}`} />
        <Slider label="Saturation" value={lerp(0.5, 0.78, k)} display={`+${Math.round(k * 45)}`} highlight={st.p > 0.08 && st.p < 0.43} />
        <Slider label="Temperature" value={lerp(0.5, 0.64, k)} display={`${Math.round(5600 + k * 900)}K`} />
        <div className="hs-kf-row">
          <Icon d={I.diamond} size={11} fill="var(--hs-accent)" stroke="none" />
          Keyframes on Scale · {st.keyframes.filter((f) => f.r > 0.5).length}
        </div>
      </>
    );
  } else if (st.inspector === 'speed') {
    title = 'Speed curve';
    const len = 400;
    body = (
      <>
        <div className="hs-presets">
          {['Normal', 'Montage', 'Hero', 'Bullet', 'Flash in'].map((n, i) => (
            <span key={n} className={i === 2 ? 'on' : ''}>
              {n}
            </span>
          ))}
        </div>
        <svg className="hs-curve" viewBox="0 0 240 120">
          {[30, 60, 90].map((y) => (
            <line key={y} x1="0" x2="240" y1={y} y2={y} stroke="rgba(255,255,255,0.07)" />
          ))}
          <path
            pathLength={len}
            d="M0 60 C 40 60, 50 20, 80 22 S 110 100, 140 98 S 190 30, 240 34"
            fill="none"
            stroke="var(--hs-accent)"
            strokeWidth="2.5"
            strokeDasharray={len}
            strokeDashoffset={len * (1 - st.speedDraw)}
          />
          {[0, 80, 140, 240].map((x, i) => (
            <circle key={x} cx={x} cy={[60, 22, 98, 34][i]} r="4" fill="#fff" opacity={st.speedDraw > i / 3 ? 1 : 0} />
          ))}
        </svg>
        <div className="hs-props">
          <span>Preset</span>
          <b>Hero</b>
          <span>Range</span>
          <b>0.3× – 3.0×</b>
          <span>Pitch</span>
          <b>Preserved</b>
        </div>
      </>
    );
  } else if (st.inspector === 'montage') {
    title = 'Montage settings';
    body = (
      <>
        <Slider label="Energy" value={0.8} display="High" />
        <Slider label="Min clip length" value={0.3} display="1 bar" />
        <div className="hs-props">
          <span>On cut</span>
          <b>Flash + zoom</b>
          <span>Order</span>
          <b>Smart shuffle</b>
          <span>Length</span>
          <b>Fit to song</b>
        </div>
      </>
    );
  } else if (st.inspector === 'caption') {
    title = 'Caption style';
    body = (
      <>
        <div className="hs-presets">
          {['Karaoke', 'Bold pop', 'Minimal', 'Subtitle'].map((n, i) => (
            <span key={n} className={i === 0 ? 'on' : ''}>
              {n}
            </span>
          ))}
        </div>
        <div className="hs-props">
          <span>Font</span>
          <b>Inter Black</b>
          <span>Position</span>
          <b>Lower third</b>
        </div>
        <div className="hs-swatches">
          {['#ffffff', '#00c8ff', '#ffd23f', '#ff5e7e', '#8b7cf6'].map((c, i) => (
            <i key={c} style={{ background: c }} className={i === 1 ? 'on' : ''} />
          ))}
        </div>
        <Slider label="Size" value={0.62} display="64 px" />
        <Slider label="Outline" value={0.3} display="3 px" />
      </>
    );
  } else if (st.inspector === 'shorts') {
    title = 'Reformat';
    const on = st.shorts > 0.02 || st.p > 0.1;
    body = (
      <>
        <label className="hs-label">Aspect ratio</label>
        <div className="hs-aspects">
          {[
            ['16:9', 30, 17],
            ['1:1', 22, 22],
            ['9:16', 15, 26],
            ['4:5', 20, 25],
          ].map(([n, w, h]) => (
            <span key={n} className={(n === '9:16' && on) || (n === '16:9' && !on) ? 'on' : ''}>
              <i style={{ width: w, height: h }} />
              {n}
            </span>
          ))}
        </div>
        <div className="hs-toggle-row">
          Auto-reframe on subject <span className="hs-toggle on" />
        </div>
        <div className="hs-toggle-row">
          Keep captions safe-zone <span className="hs-toggle on" />
        </div>
        <label className="hs-label">Publish for</label>
        <div className="hs-lang">
          <span className="on">TikTok</span>
          <span className="on">Reels</span>
          <span className="on">YT Shorts</span>
        </div>
      </>
    );
  }
  return (
    <div className="hs-right">
      <div className="hs-panel-head">
        <span>{title}</span>
      </div>
      <div className="hs-right-body">{body}</div>
    </div>
  );
}

function variantAt(st) {
  if (st.montage >= 1 || (st.scene.id === 'montage' && st.montage > 0.5)) {
    const c = MONTAGE.find((m) => st.playhead >= m.s && st.playhead < m.e) || MONTAGE[0];
    return { v: c.v, local: st.playhead - c.s };
  }
  const c = st.v1.find((m) => st.playhead >= m.s && st.playhead < m.e) || st.v1[0];
  return { v: c.v, local: st.playhead - c.s };
}

function Preview({ st }) {
  const { v, local } = variantAt(st);
  const g = st.grade;
  const filter = `saturate(${g.sat}) hue-rotate(${g.hue}deg) brightness(${g.bri}) contrast(${g.con})`;
  const inPip = st.v2[0].r > 0.5 && st.playhead >= 8 && st.playhead < 12;
  const fx = subjectX(local);
  // shorts crop window
  const cropW = lerp(PV.w, (PV.h * 9) / 16, st.shorts);
  const cropCx = lerp(0.5, clamp(fx, 0.25, 0.75), st.shorts) * PV.w;
  const cropX = clamp(cropCx - cropW / 2, 0, PV.w - cropW);
  const c = st.captions;
  return (
    <div className="hs-preview-area">
      <div className="hs-preview" style={{ left: PV.x - 344, top: PV.y - 44, width: PV.w, height: PV.h }}>
        {st.previewEmpty ? (
          <div className="hs-drop">
            <Icon d={I.media} size={28} />
            <span>Drop media here</span>
          </div>
        ) : (
          <>
            <div className="hs-frame" style={{ transform: `scale(${st.zoom})`, filter: st.wipe === null ? filter : undefined }}>
              <Footage variant={v} time={local} subject={v === 'sunset'} />
            </div>
            {st.wipe !== null && (
              <>
                <div className="hs-frame" style={{ transform: `scale(${st.zoom})`, filter, clipPath: `inset(0 0 0 ${st.wipe * 100}%)` }}>
                  <Footage variant={v} time={local} subject={v === 'sunset'} />
                </div>
                <div className="hs-wipe" style={{ left: `${st.wipe * 100}%` }}>
                  <span>Before</span>
                  <span>After</span>
                </div>
              </>
            )}
            {inPip && st.shorts === 0 && (
              <div className="hs-pip">
                <Footage variant="city" time={st.playhead} />
              </div>
            )}
            {st.t1[0].r > 0.5 && st.playhead >= 1 && st.playhead < 7 && !c && st.shorts === 0 && (
              <div className="hs-title-card" style={{ opacity: seg(st.playhead, 1, 1.5) * (1 - seg(st.playhead, 6.5, 7)) }}>
                GOLDEN HOUR
                <small>Kigali · 2026</small>
              </div>
            )}
            {st.flash > 0 && <div className="hs-flash" style={{ opacity: st.flash * 0.55 }} />}
            {c && c.word >= 0 && (
              <div className="hs-caption">
                {(c.word < 4 ? CAPTION_WORDS.slice(0, 4) : CAPTION_WORDS.slice(4)).map((w, i) => {
                  const idx = c.word < 4 ? i : i + 4;
                  const on = idx === c.word;
                  const past = idx < c.word;
                  return (
                    <span key={w + idx} className={on ? 'on' : past ? 'past' : ''} style={on ? { transform: `scale(${1 + 0.12 * Math.sin(Math.min(1, c.wordP * 3) * Math.PI)})` } : undefined}>
                      {w}
                    </span>
                  );
                })}
              </div>
            )}
            {st.shorts > 0 && (
              <>
                <div className="hs-crop-dim" style={{ left: 0, width: cropX }} />
                <div className="hs-crop-dim" style={{ left: cropX + cropW, right: 0 }} />
                <div className="hs-crop" style={{ left: cropX, width: cropW }}>
                  {st.shorts > 0.6 && (
                    <div
                      className="hs-track-box"
                      style={{ left: fx * PV.w - cropX - 20, opacity: seg(st.shorts, 0.6, 1) }}
                    >
                      <span>Subject</span>
                    </div>
                  )}
                  <span className="hs-crop-label" style={{ opacity: seg(st.shorts, 0.7, 1) }}>
                    9:16 · 1080×1920
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div className="hs-preview-ctrl">
        <Icon d={I.play} size={12} fill="currentColor" stroke="none" />
        <span>
          {fmtTC(st.playhead)} / {fmtTC(27)}
        </span>
      </div>
    </div>
  );
}

function Clip({ x, w, y, kind, children, r = 1, sel, style }) {
  if (r <= 0) return null;
  return (
    <div
      className={`hs-clip ${kind} ${sel ? 'sel' : ''}`}
      style={{ left: x, top: y + 3, width: Math.max(4, w), height: TRACK_H - 6, opacity: r, transform: `translateX(${(1 - r) * 40}px)`, ...style }}
    >
      {children}
    </div>
  );
}

function Timeline({ st }) {
  const inMontage = st.scene.id === 'montage';
  const ticks = [];
  for (let s = 0; s <= 30; s += 1) ticks.push(s);
  const beatCount = Math.floor(27 / BEAT);
  return (
    <div className="hs-timeline">
      <div className="hs-tl-tools">
        {[I.undo, I.split, I.trash].map((d, i) => (
          <span key={i} className="hs-tool">
            <Icon d={d} size={14} />
          </span>
        ))}
        <span className="hs-tool on">
          <Icon d={I.magnet} size={14} /> Snap
        </span>
        <span className="hs-tl-spacer" />
        <span className="hs-tl-meta">4 tracks · {fmtTC(27)}</span>
        <span className="hs-zoom">
          <i />
        </span>
      </div>
      <div className="hs-ruler">
        {ticks.map((s) => (
          <span key={s} className={s % 5 === 0 ? 'major' : ''} style={{ left: tx(s) - 64 }}>
            {s % 5 === 0 ? fmt(s) : ''}
          </span>
        ))}
      </div>
      {TRACKS.map((tr, i) => (
        <div key={tr.id} className="hs-track-head" style={{ top: trackY(i) - TL_Y }}>
          <b>{tr.id}</b>
          <span>{tr.label}</span>
          <div>
            <Icon d={I.eye} size={10} />
            <Icon d={I.lock} size={10} />
          </div>
        </div>
      ))}
      {TRACKS.map((tr, i) => (
        <div key={tr.id + 'lane'} className="hs-lane" style={{ top: trackY(i) - TL_Y }} />
      ))}

      {/* T1 text */}
      {st.captions && st.captions.lines > 0
        ? TRANSCRIPT.map((l, i) => (
            <Clip key={l[0]} kind="text caption" x={tx(i * 2.5) - 64} w={2.3 * PXS} y={trackY(0) - TL_Y} r={eo(seg(st.captions.lines, i * 0.22, i * 0.22 + 0.3))}>
              <span>{l[1]}</span>
            </Clip>
          ))
        : st.t1.map((c) => (
            <Clip key={c.label} kind="text" x={tx(c.s) - 64} w={(c.e - c.s) * PXS} y={trackY(0) - TL_Y} r={c.r}>
              <span>T · {c.label}</span>
            </Clip>
          ))}
      {/* V2 */}
      {st.v2.map((c) => (
        <Clip key="v2" kind="video overlay" x={tx(c.s) - 64} w={(c.e - c.s) * PXS} y={trackY(1) - TL_Y} r={c.r}>
          <Strip v={c.v} w={(c.e - c.s) * PXS} />
          <span>{c.label}</span>
        </Clip>
      ))}
      {/* V1 */}
      {inMontage && st.montage > 0
        ? MONTAGE.map((c, i) => {
            const r = eo(seg(st.montage, i * 0.1, i * 0.1 + 0.35));
            return (
              <Clip key={'m' + i} kind="video" x={tx(c.s) - 64} w={(c.e - c.s) * PXS - 2} y={trackY(2) - TL_Y} r={r}>
                <Strip v={c.v} w={(c.e - c.s) * PXS} />
                <span>Cut {i + 1}</span>
              </Clip>
            );
          })
        : st.v1.map((c, i) => (
            <Clip
              key={'v1' + i}
              kind="video"
              x={tx(c.s) - 64}
              w={(c.e - c.s) * PXS - 2}
              y={trackY(2) - TL_Y}
              r={inMontage ? 1 - st.montage * 3 : c.r}
              sel={st.selected === i && st.tab !== 'media'}
            >
              <Strip v={c.v} w={(c.e - c.s) * PXS} />
              <span>{MEDIA_NAMES[c.v]}</span>
              {st.trimHandle && i === 1 ? <i className="hs-handle" /> : null}
              {i === 0 &&
                st.keyframes.map((k) =>
                  k.r > 0 ? (
                    <b key={k.t} className="hs-kf" style={{ left: k.t * PXS - 5, transform: `rotate(45deg) scale(${k.r})` }} />
                  ) : null
                )}
            </Clip>
          ))}
      {st.transition > 0 && !inMontage && (
        <div className="hs-transition" style={{ left: tx(6) - 64 - 13, top: trackY(2) - TL_Y + 9, opacity: st.transition, transform: `scale(${0.5 + 0.5 * st.transition})` }}>
          <Icon d="M4 6l8 6-8 6z M20 6l-8 6 8 6z" size={14} fill="currentColor" stroke="none" />
          <span style={{ opacity: seg(st.transition, 0.5, 1) }}>Dissolve</span>
        </div>
      )}
      {/* A1 */}
      <Clip kind="audio" x={tx(0) - 64} w={27 * PXS} y={trackY(3) - TL_Y} r={st.a1r}>
        <Waveform width={Math.round(27 * PXS)} height={TRACK_H - 16} seconds={27} />
        <span className="hs-audio-name">♪ afro-house-mix.mp3</span>
      </Clip>
      {/* beat markers */}
      {st.beats > 0 &&
        inMontage &&
        Array.from({ length: beatCount }).map((_, i) => {
          const s = i * BEAT;
          if (s / 27 > st.beats) return null;
          const bar = i % 8 === 0;
          return <i key={i} className={`hs-beat ${bar ? 'bar' : ''}`} style={{ left: tx(s) - 64, top: bar ? trackY(2) - TL_Y : trackY(3) - TL_Y, height: bar ? TRACK_H * 2 + 2 : TRACK_H }} />;
        })}
      {/* shorts moments */}
      {st.moments > 0 &&
        [
          [0.5, 7.5, 94],
          [11, 18, 88],
          [19.5, 26.5, 81],
        ].map(([s, e, sc], i) => {
          const r = eo(seg(st.moments, i * 0.25, i * 0.25 + 0.4));
          return (
            <div key={s} className="hs-moment" style={{ left: tx(s) - 64, width: (e - s) * PXS, top: trackY(1) - TL_Y + 4, opacity: r }}>
              #{i + 1} · {sc}
            </div>
          );
        })}
      {st.snap > 0 && <i className="hs-snap" style={{ left: tx(12) - 64, opacity: st.snap }} />}
      {/* playhead */}
      <div className="hs-playhead" style={{ left: tx(st.playhead) - 64 }}>
        <i />
      </div>
    </div>
  );
}

const Strip = memo(function Strip({ v, w }) {
  const n = Math.max(1, Math.round(w / 56));
  return (
    <div className="hs-strip">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i}>
          <Footage variant={v} time={i * 2} />
        </div>
      ))}
    </div>
  );
});

function ExportModal({ st }) {
  if (st.exportModal <= 0) return null;
  const pct = Math.round(st.exportProg * 100);
  const stage = pct < 35 ? 'Building filter graph · 4 tracks' : pct < 80 ? 'Encoding H.264 · 1080p60' : 'Muxing audio';
  return (
    <div className="hs-modal-wrap" style={{ opacity: st.exportModal }}>
      <div className="hs-modal" style={{ transform: `translateY(${(1 - st.exportModal) * 16}px)` }}>
        {st.exportDone > 0 ? (
          <div className="hs-done" style={{ opacity: st.exportDone, transform: `scale(${0.9 + 0.1 * st.exportDone})` }}>
            <div className="hs-done-icon">
              <Icon d={I.check} size={30} sw={3} />
            </div>
            <b>Export complete</b>
            <span>golden-hour-promo.mp4 · 1080p · 42 MB</span>
            <div className="hs-done-row">
              <span>
                <Icon d={I.cloud} size={14} /> Saved to your projects
              </span>
              <span>
                <Icon d={I.check} size={14} /> Synced across devices
              </span>
            </div>
          </div>
        ) : (
          <>
            <b className="hs-modal-title">Export video</b>
            <label className="hs-label">Resolution</label>
            <div className="hs-seg wide">
              <span>720p</span>
              <span className="on">1080p</span>
              <span>1440p</span>
              <span>4K</span>
            </div>
            <div className="hs-modal-grid">
              <div>
                <label className="hs-label">Frame rate</label>
                <div className="hs-seg">
                  <span>30</span>
                  <span className="on">60</span>
                </div>
              </div>
              <div>
                <label className="hs-label">Format</label>
                <div className="hs-seg">
                  <span className="on">MP4</span>
                  <span>WebM</span>
                </div>
              </div>
            </div>
            {st.exportProg > 0 ? (
              <div className="hs-progress">
                <div className="hs-progress-top">
                  <span>{stage}</span>
                  <b>{pct}%</b>
                </div>
                <div className="hs-progress-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <em>
                  <span className="hs-bpm-dot" /> Live progress over Socket.IO
                </em>
              </div>
            ) : (
              <div className="hs-modal-actions">
                <span className="hs-ghost">Cancel</span>
                <span className={`hs-export-btn big ${st.pressed === 'export' ? 'pressed' : ''}`}>Export</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Outro({ st }) {
  if (st.outro <= 0) return null;
  return (
    <div className="hs-outro" style={{ opacity: st.outro }}>
      <div style={{ transform: `translateY(${(1 - st.outro) * 14}px)` }}>
        <div className="hs-outro-logo">
          {BRAND_A}
          <span className="hs-accent">{BRAND_B}</span>
        </div>
        <p>Edit like a pro, right in your browser.</p>
        <div className="hs-outro-tags">
          {CHAPTERS.map((c) => (
            <span key={c.id}>{c.short}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cursor({ st }) {
  const { x, y, down } = st.cursor;
  return (
    <div className="hs-cursor" style={{ transform: `translate(${x}px, ${y}px)`, opacity: st.cursorVis }}>
      {down && <span className="hs-cursor-ring" />}
      <svg width="22" height="22" viewBox="0 0 24 24" style={{ transform: `scale(${down ? 0.88 : 1})` }}>
        <path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.8L4 20z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Stage({ t }) {
  const st = computeState(t);
  let Left = MediaPanel;
  if (st.tab === 'montage') Left = MontagePanel;
  if (st.tab === 'captions') Left = CaptionsPanel;
  if (st.tab === 'shorts') Left = ShortsPanel;
  return (
    <div className="hs-stage" style={{ width: W, height: H }}>
      <TopBar st={st} />
      <Sidebar st={st} />
      <Left st={st} />
      <Preview st={st} />
      <Inspector st={st} />
      <Timeline st={st} />
      {st.drag && (
        <div className="hs-drag" style={{ left: st.drag.x - 50, top: st.drag.y - 28 }}>
          <Footage variant={st.drag.v} time={0} subject />
        </div>
      )}
      <ExportModal st={st} />
      <Outro st={st} />
      <Cursor st={st} />
    </div>
  );
}

/* ---------- player ---------- */
export default function HeroShowcase({ videoSrc, poster, controls = true, renderTime }) {
  const holderRef = useRef(null);
  const barRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(true);
  const controlled = typeof renderTime === 'number';
  const time = controlled ? renderTime : t;

  useEffect(() => {
    if (controlled) return;
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) {
      setPlaying(false);
      setT(SCENES[2].start + 2.2);
    }
  }, [controlled]);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
    const update = () => setScale(el.clientWidth / W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || controlled || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [controlled]);

  useEffect(() => {
    if (controlled || videoSrc || !playing || !inView) return undefined;
    let raf;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!document.hidden) setT((prev) => (prev + dt) % TOTAL);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controlled, videoSrc, playing, inView]);

  const scrubTo = useCallback((clientX) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setT(clamp((clientX - r.left) / r.width) * (TOTAL - 0.01));
  }, []);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  };
  const onPointerMove = (e) => {
    if (e.buttons === 1) scrubTo(e.clientX);
  };
  const onBarKey = (e) => {
    if (e.key === 'ArrowRight') setT((v) => Math.min(TOTAL - 0.01, v + 2));
    if (e.key === 'ArrowLeft') setT((v) => Math.max(0, v - 2));
  };

  const current = useMemo(() => {
    let c = CHAPTERS[0];
    for (const s of CHAPTERS) if (time >= s.start) c = s;
    return c;
  }, [time]);

  return (
    <div className="hs-root">
      <div className="hs-window">
        <div className="hs-window-bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>app.nexeditor.com/editor</span>
        </div>
        <div className="hs-holder" ref={holderRef} style={{ height: H * scale }}>
          {videoSrc ? (
            <video className="hs-video" src={videoSrc} poster={poster} autoPlay muted loop playsInline aria-label="NexEditor product demo" />
          ) : (
            <div className="hs-scaler" style={{ transform: `scale(${scale})` }} role="img" aria-label={`NexEditor product demo — ${current.label}`}>
              <Stage t={time} />
            </div>
          )}
        </div>
      </div>

      {controls && !controlled && !videoSrc && (
        <div className="hs-controls">
          <button type="button" className="hs-play" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pause demo' : 'Play demo'}>
            <Icon d={playing ? I.pause : I.play} size={14} fill="currentColor" stroke="none" />
          </button>
          <div
            className="hs-bar"
            ref={barRef}
            role="slider"
            tabIndex={0}
            aria-label="Demo position"
            aria-valuemin={0}
            aria-valuemax={Math.round(TOTAL)}
            aria-valuenow={Math.round(time)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onBarKey}
          >
            {SCENES.map((s) => (
              <span key={s.id} className="hs-bar-seg" style={{ flex: s.dur }}>
                <i style={{ width: `${clamp((time - s.start) / s.dur) * 100}%` }} />
              </span>
            ))}
          </div>
          <span className="hs-time">
            {fmt(time)} / {fmt(TOTAL)}
          </span>
        </div>
      )}
      {controls && !controlled && !videoSrc && (
        <div className="hs-chapters" role="tablist" aria-label="Demo chapters">
          {CHAPTERS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={current.id === c.id}
              className={current.id === c.id ? 'active' : ''}
              onClick={() => setT(c.start + 0.01)}
            >
              <b>{String(i + 1).padStart(2, '0')}</b>
              {c.short}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
