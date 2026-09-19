// One-click camera-move presets ("Animate" in the inspector, and the motion
// every LongMix scene image gets automatically - see longMix.js). Each one
// is nothing more than a normal keyframe set written across the clip's full
// duration, so once applied it's editable exactly like hand-placed
// keyframes: drag the values, move the points, delete one, mix in a
// rotation - none of this is a special mode the clip is stuck in.
//
// Why the pan presets also zoom: transform.x/y translate the clip inside the
// frame, so panning a clip that exactly fits the canvas would drag black
// bars in behind it. Scaling past 1 first gives the picture some overhang to
// pan within - PAN_ZOOM's 1.18 leaves 9% of the canvas width of slack on
// each side, and PAN_TRAVEL (8% of half the canvas width, the unit
// transform.x uses - see normalizeClip) stays inside it. The export clamps
// the same way the preview's canvas edges do, so keeping the pan within the
// overhang is also what keeps the two identical.
const PAN_ZOOM = 1.18;
const PAN_TRAVEL = 8;

export const MOTION_PRESETS = [
  {
    id: 'zoom-in',
    label: 'Zoom in',
    // A slow push in. Subtle on purpose: this is the default applied to a
    // freshly dropped image, and a strong zoom over a 3-minute song scene
    // would end up deep inside the picture by the end of it.
    build: (duration) => ({
      scaleX: [{ t: 0, value: 1 }, { t: duration, value: 1.15 }],
      scaleY: [{ t: 0, value: 1 }, { t: duration, value: 1.15 }],
    }),
  },
  {
    id: 'zoom-out',
    label: 'Zoom out',
    build: (duration) => ({
      scaleX: [{ t: 0, value: 1.15 }, { t: duration, value: 1 }],
      scaleY: [{ t: 0, value: 1.15 }, { t: duration, value: 1 }],
    }),
  },
  {
    id: 'pan-right',
    label: 'Pan left → right',
    // The picture travels left-to-right across the frame, which means the
    // clip's own x offset runs from positive (shifted right, showing its
    // left edge) to negative.
    build: (duration) => ({
      scaleX: [{ t: 0, value: PAN_ZOOM }, { t: duration, value: PAN_ZOOM }],
      scaleY: [{ t: 0, value: PAN_ZOOM }, { t: duration, value: PAN_ZOOM }],
      x: [{ t: 0, value: PAN_TRAVEL }, { t: duration, value: -PAN_TRAVEL }],
    }),
  },
  {
    id: 'pan-left',
    label: 'Pan right → left',
    build: (duration) => ({
      scaleX: [{ t: 0, value: PAN_ZOOM }, { t: duration, value: PAN_ZOOM }],
      scaleY: [{ t: 0, value: PAN_ZOOM }, { t: duration, value: PAN_ZOOM }],
      x: [{ t: 0, value: -PAN_TRAVEL }, { t: duration, value: PAN_TRAVEL }],
    }),
  },
];

export const DEFAULT_IMAGE_MOTION_PRESET_ID = 'zoom-in';

// Builds the keyframe tracks for a preset over a clip of `duration` seconds,
// merged onto whatever the clip already has so an existing opacity/rotation
// animation survives being given a camera move. A duration of 0 (or a
// missing preset id) returns the keyframes untouched rather than writing two
// points at the same instant, which would read as an instant jump.
export function applyMotionPreset(keyframes, presetId, duration) {
  const preset = MOTION_PRESETS.find((item) => item.id === presetId);
  if (!preset || !(duration > 0)) return keyframes;
  return { ...keyframes, ...preset.build(Number(duration.toFixed(3))) };
}

// Clears just the camera-move tracks, leaving every other animated property
// alone - what the inspector's "None" button does.
export function clearMotionPreset(keyframes) {
  return { ...keyframes, scaleX: [], scaleY: [], x: [], y: [] };
}
