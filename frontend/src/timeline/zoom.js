// Timeline zoom maths, CapCut-style.
//
// Zoom is a percentage of PX_PER_SECOND (100% = 24 px per second, the value
// saved projects already store). The range runs from whole hours fitting on
// screen (ZOOM_MIN) to single frames about 20 px wide (ZOOM_MAX), and moves
// on a logarithmic scale - each slider step or key press multiplies the
// scale by the same factor, which is how zoom feels even in every NLE.

export const PX_PER_SECOND = 24;
export const ZOOM_MIN = 0.2; // ~0.05 px/s: a 4-hour mix fits in ~700 px
export const ZOOM_MAX = 2500; // 600 px/s: one frame at 30 fps is 20 px
export const ZOOM_STEP = 1.4; // Ctrl +/- and the magnifier buttons
const SLIDER_MAX = 1000;

export function clampZoom(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value) || value <= 0) return 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function pxPerSecondFor(zoom) {
  return PX_PER_SECOND * (clampZoom(zoom) / 100);
}

// Slider position (0..1000) <-> zoom %, logarithmic.
export function zoomToSlider(zoom) {
  return Math.round((Math.log(clampZoom(zoom) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * SLIDER_MAX);
}

export function sliderToZoom(position) {
  const t = Math.min(SLIDER_MAX, Math.max(0, Number(position) || 0)) / SLIDER_MAX;
  return ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** t;
}

export const SLIDER_RANGE = SLIDER_MAX;

// The zoom that makes `duration` seconds fill `width` pixels.
export function fitZoom(duration, width) {
  if (!(duration > 0) || !(width > 0)) return 100;
  return clampZoom((width / duration / PX_PER_SECOND) * 100);
}

// Labelled-tick intervals. Below one second they're whole frames (so the
// ruler reads 0:05 · 10f · 20f · 0:06 when zoomed right in); above, the usual
// 1s / 5s / 10s / 30s / 1 min ... / hours.
const FRAME_STEPS = [1, 2, 5, 10, 15];
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000];
export const MIN_TICK_PX_GAP = 64;

export function rulerStep(pxPerSecond, fps = 30) {
  const rate = Math.max(1, Math.round(fps || 30));
  for (const frames of FRAME_STEPS) {
    if (frames >= rate) break;
    if ((frames / rate) * pxPerSecond >= MIN_TICK_PX_GAP) return { step: frames / rate, frames, rate };
  }
  for (const seconds of SECOND_STEPS) {
    if (seconds * pxPerSecond >= MIN_TICK_PX_GAP) return { step: seconds, frames: seconds * rate, rate };
  }
  return { step: SECOND_STEPS[SECOND_STEPS.length - 1], frames: SECOND_STEPS[SECOND_STEPS.length - 1] * rate, rate };
}

function clock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

// Ticks between `from` and `to` seconds only - a zoomed-in multi-hour
// project would otherwise mean hundreds of thousands of tick elements.
// Everything is computed in whole frames so fractional steps never drift.
export function rulerTicks(pxPerSecond, fps, from, to) {
  const { step, frames, rate } = rulerStep(pxPerSecond, fps);
  const minorDivisions = step * pxPerSecond >= 90 ? 5 : 2;
  const minorFrames = frames / minorDivisions;
  const startIndex = Math.max(0, Math.floor((from * rate) / frames));
  const endIndex = Math.ceil((to * rate) / frames);
  const major = [];
  const minor = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    const frame = i * frames;
    const t = frame / rate;
    const withinSecond = frame % rate;
    major.push({ t, label: withinSecond === 0 ? clock(frame / rate) : `${withinSecond}f` });
    if (Number.isInteger(minorFrames) || minorDivisions === 2) {
      for (let k = 1; k < minorDivisions; k += 1) minor.push((frame + minorFrames * k) / rate);
    }
  }
  return { step, major, minor };
}
