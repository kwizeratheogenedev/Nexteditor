import { useEffect, useMemo, useState } from 'react';
import { useEditorTimeline, useEditorPlayback, useSelectedEditorClip } from '../context/EditorStateContext';
import { resolveKeyframedValue, upsertKeyframe, removeKeyframeNear, findKeyframeNear, getClipStartTime } from '../timeline/keyframes';
import { COLOR_PRESETS, findMatchingPresetId } from '../timeline/colorPresets';
import { expectedTransitionStart, TRANSITION_TYPES, clipDuration as clipOutputDuration } from '../timeline/transitions';
import { hasSpeedCurve, sourceTimeForOutputElapsed, currentSegmentSpeed } from '../timeline/speedCurve';
import { MOTION_PRESETS, applyMotionPreset, clearMotionPreset } from '../timeline/motionPresets';
import { isVideoLikeClip } from '../timeline/clipKinds';
import { formatTimecode } from '../timeline/timecode';

// One inspector value: label on the left, value (and its ◆ keyframe
// toggle) on the right, a thin slider underneath - the studio layout.
// Dragging updates the local draft; the change is committed (one undo step)
// when the drag ends.
function Slider({ label, display, min, max, step = 1, value, onChange, onCommit, keyframe }) {
  const pct = max > min ? ((Number(value) - min) / (max - min)) * 100 : 0;
  return (
    <div className="st-field">
      <div className="st-field-head">
        <span>{label}</span>
        <span className="st-field-value">{keyframe}{display}</span>
      </div>
      <input
        className="st-range"
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${Math.max(0, Math.min(100, pct))}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="st-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={Boolean(checked)} onChange={onChange} />
      <i aria-hidden="true" />
    </label>
  );
}

function Collapsible({ title, badge, children }) {
  return (
    <details className="st-collapse">
      <summary>
        <span>{title}</span>
        {badge && <em>{badge}</em>}
      </summary>
      <div className="st-collapse-body">{children}</div>
    </details>
  );
}

function KeyframeButton({ active, hasAny, onClick, title }) {
  return (
    <button
      type="button"
      className={`st-kf ${active ? 'is-active' : ''} ${hasAny ? 'has-keyframes' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      ◆
    </button>
  );
}

// 100% = 0 dB, like a mixer.
function volumeDb(percent) {
  if (percent <= 0) return '-∞ dB';
  const db = 20 * Math.log10(percent / 100);
  const rounded = Math.round(db);
  return `${rounded > 0 ? '+' : ''}${rounded} dB`;
}

// Organizational tag colors for a clip block - purely a timeline display
// aid (see normalizeClip's `color` field), not sent in the export payload.
const CLIP_COLOR_PRESETS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#7c3aed', '#ec4899'];

const DEFAULT_TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
const DEFAULT_COLOR_PARAMS = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };
const DEFAULT_CHROMA_KEY_PARAMS = { color: '#00ff00', similarity: 35, blend: 15 };
const CHROMA_KEY_PRESETS = [
  { label: 'Green', color: '#00ff00' },
  { label: 'Blue', color: '#0000ff' },
];
const DEFAULT_TEXT_STYLE = { content: '', fontFamily: 'Inter, sans-serif', fontSize: 64, color: '#ffffff', align: 'center' };
const DEFAULT_KEYFRAMES = { x: [], y: [], rotation: [], opacity: [], volume: [], speed: [], scaleX: [], scaleY: [] };
const KEYFRAME_PROPS = ['x', 'y', 'rotation', 'opacity'];
// Scale is keyframeable too, but through its own commit path: the panel has
// a single Scale slider driving both axes, and the flip toggles own the
// sign of transform.scaleX/scaleY, so the keyframe tracks carry magnitude
// only and always move as a pair (see commitBasic/toggleScaleKeyframe).
const SCALE_KEYFRAME_PROPS = ['scaleX', 'scaleY'];

function findColorFilter(filters) {
  return (filters || []).find((filter) => filter.type === 'color') || { id: 'color', type: 'color', enabled: true, params: DEFAULT_COLOR_PARAMS };
}

function findVignetteFilter(filters) {
  return (filters || []).find((filter) => filter.type === 'vignette') || { id: 'vignette', type: 'vignette', enabled: true, params: { intensity: 0 } };
}

function findChromaKeyFilter(filters) {
  return (filters || []).find((filter) => filter.type === 'chromaKey') || { id: 'chromaKey', type: 'chromaKey', enabled: false, params: DEFAULT_CHROMA_KEY_PARAMS };
}

// Defensive against clips missing the newer transform/filters/speed/volume
// fields (e.g. a project saved by an older build) - falls back to defaults
// per-field instead of assuming the whole clip is fully normalized.
// `clipLocalTime` resolves keyframed x/y/rotation/opacity at the given point
// in the clip instead of showing the static (non-animated) baseline.
function draftFromClip(clip, clipLocalTime) {
  if (!clip) {
    return {
      basic: { scale: 100, opacity: 100, rotation: 0, x: 0, y: 0, flipH: false, flipV: false },
      color: { ...DEFAULT_COLOR_PARAMS },
      vignette: 0,
      chromaKey: { enabled: false, ...DEFAULT_CHROMA_KEY_PARAMS },
      speed: 1,
      audio: { volume: 100, fadeIn: 0, fadeOut: 0, muted: false, duckEnabled: false, duckAmount: 70 },
      text: { ...DEFAULT_TEXT_STYLE },
      transitionOut: 0,
    };
  }
  const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
  const color = { ...DEFAULT_COLOR_PARAMS, ...findColorFilter(clip.filters).params };
  const vignette = findVignetteFilter(clip.filters).params.intensity || 0;
  const chromaKeyFilter = findChromaKeyFilter(clip.filters);
  const chromaKey = { enabled: chromaKeyFilter.enabled === true, ...DEFAULT_CHROMA_KEY_PARAMS, ...chromaKeyFilter.params };
  const opacity01 = resolveKeyframedValue(kf.opacity, clipLocalTime, t.opacity);
  return {
    basic: {
      scale: Math.round(resolveKeyframedValue(kf.scaleX, clipLocalTime, Math.abs(t.scaleX)) * 100),
      opacity: Math.round(opacity01 * 100),
      rotation: resolveKeyframedValue(kf.rotation, clipLocalTime, t.rotation),
      x: resolveKeyframedValue(kf.x, clipLocalTime, t.x),
      y: resolveKeyframedValue(kf.y, clipLocalTime, t.y),
      flipH: t.scaleX < 0,
      flipV: t.scaleY < 0,
    },
    color,
    vignette,
    chromaKey,
    // A curved clip's displayed speed tracks the segment active at the
    // playhead (mirrors how the volume envelope's slider shows the
    // interpolated value, not the flat field) - see timeline/speedCurve.js.
    speed: hasSpeedCurve(clip) ? currentSegmentSpeed(clip, clipLocalTime) : (typeof clip.speed === 'number' ? clip.speed : 1),
    audio: {
      volume: Math.round(resolveKeyframedValue(kf.volume, clipLocalTime, typeof clip.volume === 'number' ? clip.volume : 1) * 100),
      fadeIn: clip.audioFade?.in || 0,
      fadeOut: clip.audioFade?.out || 0,
      muted: Boolean(clip.muted),
      duckEnabled: Boolean(clip.duck?.enabled),
      duckAmount: typeof clip.duck?.amount === 'number' ? clip.duck.amount : 70,
    },
    text: { ...DEFAULT_TEXT_STYLE, ...clip.text },
    transitionOut: clip.transitionOut?.duration || 0,
  };
}


function RightPanel({ fps = 30, describeTrack }) {
  const { timeline, selectedClipId, selectedClipIds, updateClip, commitTimeline } = useEditorTimeline();
  const { playhead } = useEditorPlayback();
  const selectedClip = useSelectedEditorClip();
  const isTextClip = selectedClip?.type === 'text';
  const isAudioClip = selectedClip?.type === 'audio';
  const isAdjustmentClip = selectedClip?.type === 'adjustment';
  const [showAllLooks, setShowAllLooks] = useState(false);

  // Position on this specific clip's own output timeline (0 = the clip's
  // first visible frame) - what keyframes are stored/added relative to.
  // Every clip carries its own absolute startTime since M7, so this is a
  // direct lookup regardless of type.
  const clipStartTime = useMemo(
    () => getClipStartTime(timeline, selectedClipId),
    [timeline, selectedClipId],
  );
  const clipLocalTime = playhead - clipStartTime;

  const [draft, setDraft] = useState(() => draftFromClip(selectedClip, clipLocalTime));

  // Re-sync the local draft (used for smooth slider dragging without
  // spamming the undo history on every pixel of movement) whenever the
  // selection changes, the selected clip's own data changes from outside
  // this component (undo/redo, etc), or the playhead moves over a clip with
  // keyframed properties (so scrubbing shows the interpolated value at the
  // new time). `selectedClip` only gets a new object reference when the
  // underlying clip data actually changes (see useSelectedEditorClip), so
  // this doesn't fight with the draft while a slider is mid-drag.
  useEffect(() => {
    setDraft(draftFromClip(selectedClip, clipLocalTime));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId, selectedClip, clipLocalTime]);


  // A clip that only has a remoteUrl (no local File, e.g. brought in from
  // Montage output via "Edit", or restored on a different browser than it
  // was imported on) has neither file.name nor label - falling all the way
  // through to 'No clip selected' there would be misleading since the clip
  // IS selected and its other properties do populate correctly below.
  const clipNameFromUrl = (selectedClip?.url || selectedClip?.remoteUrl || '').split('/').pop()?.split('?')[0];
  const clipName = selectedClip
    ? (selectedClip.file?.name || selectedClip.label || clipNameFromUrl || `${(selectedClip.type || 'video').replace(/^./, (c) => c.toUpperCase())} clip`)
    : 'No clip selected';
  const clipDuration = selectedClip ? (selectedClip.trimmedEnd - selectedClip.trimmedStart) : 0;
  const disabled = !selectedClip;
  // Whether this clip currently carries a camera move - drives the
  // Animate row's "None" state. Scale is the tell: every preset animates
  // it, while a pan alone would be indistinguishable from a hand-keyframed
  // position the user set up themselves.
  const hasMotionKeyframes = Boolean(selectedClip?.keyframes?.scaleX?.length);

  // Whichever clip on the selected clip's own lane comes next by position -
  // not necessarily touching: before a transition is set the pair is
  // usually touching, but once commitTransition below moves the next clip
  // to create the overlap, it's positioned earlier than that by design.
  // Deliberately no adjacency/distance check here (unlike
  // transitions.js's resolveActiveInLane, which does need one to tell a
  // real transition apart from an incidental overlap during playback) - the
  // control should always target "whatever plays next," regardless of gap.
  const nextVideoClip = useMemo(() => {
    if (isTextClip || isAudioClip || !selectedClip) return null;
    const laneClips = timeline
      .filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === (selectedClip.trackIndex || 0))
      .sort((a, b) => a.startTime - b.startTime);
    const index = laneClips.findIndex((clip) => clip.id === selectedClipId);
    if (index < 0) return null;
    return laneClips[index + 1] || null;
  }, [timeline, selectedClipId, selectedClip, isTextClip, isAudioClip]);
  const maxTransitionDuration = nextVideoClip
    ? Math.max(0.1, Math.min(3, clipDuration / (selectedClip.speed || 1), (nextVideoClip.trimmedEnd - nextVideoClip.trimmedStart) / (nextVideoClip.speed || 1)))
    : 0;
  const activeTransitionType = selectedClip?.transitionOut?.type || 'fade';
  const activeTransitionLabel = TRANSITION_TYPES.find((t) => t.id === activeTransitionType)?.label || 'Fade';

  const commitBasic = (next) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const nextKeyframes = { ...kf };
      const nextTransform = { ...clip.transform };
      const valueByProp = { x: next.x, y: next.y, rotation: next.rotation, opacity: next.opacity / 100 };

      KEYFRAME_PROPS.forEach((prop) => {
        if (kf[prop].length > 0) {
          nextKeyframes[prop] = upsertKeyframe(kf[prop], clipLocalTime, valueByProp[prop]);
        } else {
          nextTransform[prop] = valueByProp[prop];
        }
      });

      // Scale follows the same "keyframes replace the static value once any
      // exist" rule as the properties above, with the one twist that the
      // flip lives in the sign of transform.scaleX/scaleY while the
      // keyframe track carries magnitude only - so the flip toggles keep
      // writing to the transform either way, and only the magnitude moves
      // into the keyframe when the clip is animated.
      const magnitude = next.scale / 100;
      const scaleAnimated = SCALE_KEYFRAME_PROPS.some((prop) => kf[prop].length > 0);
      if (scaleAnimated) {
        SCALE_KEYFRAME_PROPS.forEach((prop) => {
          if (kf[prop].length > 0) nextKeyframes[prop] = upsertKeyframe(kf[prop], clipLocalTime, magnitude);
        });
        nextTransform.scaleX = (next.flipH ? -1 : 1) * Math.abs(nextTransform.scaleX ?? 1);
        nextTransform.scaleY = (next.flipV ? -1 : 1) * Math.abs(nextTransform.scaleY ?? 1);
      } else {
        nextTransform.scaleX = (next.flipH ? -1 : 1) * magnitude;
        nextTransform.scaleY = (next.flipV ? -1 : 1) * magnitude;
      }

      return { ...clip, transform: nextTransform, keyframes: nextKeyframes };
    });
  };

  // The Scale slider's diamond animates both axes together - the panel only
  // exposes one uniform scale, and a Ken Burns move that stretched one axis
  // without the other would just distort the picture.
  const toggleScaleKeyframe = () => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const existing = findKeyframeNear(kf.scaleX, clipLocalTime) || findKeyframeNear(kf.scaleY, clipLocalTime);
      const magnitude = draft.basic.scale / 100;
      const nextKeyframes = { ...kf };
      SCALE_KEYFRAME_PROPS.forEach((prop) => {
        nextKeyframes[prop] = existing
          ? removeKeyframeNear(kf[prop], clipLocalTime)
          : upsertKeyframe(kf[prop], clipLocalTime, magnitude);
      });
      return { ...clip, keyframes: nextKeyframes };
    });
  };

  // One-click camera moves (see timeline/motionPresets.js) - they write
  // ordinary keyframes across the clip's whole output duration, so the
  // result stays fully editable afterward and exports through the same
  // keyframe path a hand-animated clip does.
  const applyMotion = (presetId) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const nextKeyframes = presetId
        ? applyMotionPreset(kf, presetId, clipOutputDuration(clip))
        : clearMotionPreset(kf);
      return { ...clip, keyframes: nextKeyframes };
    });
  };

  const toggleKeyframe = (prop) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const existing = findKeyframeNear(kf[prop], clipLocalTime);
      const currentValue = prop === 'opacity' ? draft.basic.opacity / 100 : draft.basic[prop];
      const nextPoints = existing
        ? removeKeyframeNear(kf[prop], clipLocalTime)
        : upsertKeyframe(kf[prop], clipLocalTime, currentValue);
      return { ...clip, keyframes: { ...kf, [prop]: nextPoints } };
    });
  };

  const commitColor = (next) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const others = clip.filters.filter((filter) => filter.type !== 'color');
      const isDefault = !next.brightness && !next.contrast && !next.saturation && !next.temperature;
      return {
        ...clip,
        filters: isDefault ? others : [...others, { id: 'color', type: 'color', enabled: true, params: next }],
      };
    });
  };

  const commitVignette = (intensity) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const others = clip.filters.filter((filter) => filter.type !== 'vignette');
      return {
        ...clip,
        filters: intensity > 0 ? [...others, { id: 'vignette', type: 'vignette', enabled: true, params: { intensity } }] : others,
      };
    });
  };

  const commitChromaKey = (next) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const others = clip.filters.filter((filter) => filter.type !== 'chromaKey');
      const { enabled, ...params } = next;
      return {
        ...clip,
        filters: enabled ? [...others, { id: 'chromaKey', type: 'chromaKey', enabled: true, params }] : others,
      };
    });
  };

  // Sets/changes/clears the selected clip's transitionOut, and - in the
  // same commit - moves the adjacent next clip's startTime to match the new
  // overlap amount, since resolveActiveInLane only renders a transition
  // when the next clip actually sits at the expected overlap point (see
  // timeline/transitions.js). Both clips update atomically so Undo reverts
  // the whole edit in one step.
  const commitTransition = (duration, type) => {
    if (!selectedClipId || !nextVideoClip) return;
    const resolvedType = type || selectedClip?.transitionOut?.type || 'fade';
    const nextTransitionOut = duration > 0 ? { type: resolvedType, duration } : null;
    commitTimeline((prev) => prev.map((clip) => {
      if (clip.id === selectedClipId) return { ...clip, transitionOut: nextTransitionOut };
      if (clip.id === nextVideoClip.id) {
        const updatedSelected = { ...selectedClip, transitionOut: nextTransitionOut };
        return { ...clip, startTime: expectedTransitionStart(updatedSelected, nextVideoClip) };
      }
      return clip;
    }));
  };

  // A clip's speed points (clip.keyframes.speed) are in SOURCE-local time
  // (0 = trimmedStart), unlike every other keyframe track here which is in
  // OUTPUT-local time - a curved clip's own output/source mapping is
  // exactly what makes that conversion non-trivial, see
  // timeline/speedCurve.js's sourceTimeForOutputElapsed.
  const speedSourceLocalTime = (clip) => (
    hasSpeedCurve(clip) ? sourceTimeForOutputElapsed(clip, clipLocalTime) : clipLocalTime * (clip.speed || 1)
  );

  const commitSpeed = (value) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      // Same "keyframes replace the flat value once any exist" rule
      // commitAudio's volume slider uses - once a speed curve exists,
      // dragging the slider edits/adds the point at the current position
      // instead of the flat `speed` field.
      if (kf.speed?.length > 0) {
        return { ...clip, keyframes: { ...kf, speed: upsertKeyframe(kf.speed, speedSourceLocalTime(clip), value) } };
      }
      return { ...clip, speed: value };
    });
  };

  const toggleSpeedKeyframe = () => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const points = kf.speed || [];
      const sourceT = speedSourceLocalTime(clip);
      const existing = findKeyframeNear(points, sourceT);
      const nextPoints = existing ? removeKeyframeNear(points, sourceT) : upsertKeyframe(points, sourceT, draft.speed);
      return { ...clip, keyframes: { ...kf, speed: nextPoints } };
    });
  };

  const commitAudio = (next) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const volumeValue = next.volume / 100;
      // Same "keyframes replace the static value once any exist" rule
      // commitBasic uses for transform props - a volume envelope with at
      // least one point drives playback instead of the flat volume field.
      const nextKeyframes = kf.volume?.length > 0
        ? { ...kf, volume: upsertKeyframe(kf.volume, clipLocalTime, volumeValue) }
        : kf;
      return {
        ...clip,
        volume: volumeValue,
        audioFade: { in: next.fadeIn, out: next.fadeOut },
        muted: next.muted,
        duck: { enabled: next.duckEnabled, amount: next.duckAmount },
        keyframes: nextKeyframes,
      };
    });
  };

  const toggleVolumeKeyframe = () => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => {
      const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
      const points = kf.volume || [];
      const existing = findKeyframeNear(points, clipLocalTime);
      const currentValue = draft.audio.volume / 100;
      const nextPoints = existing ? removeKeyframeNear(points, clipLocalTime) : upsertKeyframe(points, clipLocalTime, currentValue);
      return { ...clip, keyframes: { ...kf, volume: nextPoints } };
    });
  };

  const commitText = (next) => {
    if (!selectedClipId) return;
    updateClip(selectedClipId, (clip) => ({ ...clip, text: { ...clip.text, ...next } }));
  };

  const updateDraftBasic = (patch) => setDraft((prev) => ({ ...prev, basic: { ...prev.basic, ...patch } }));
  const updateDraftColor = (patch) => setDraft((prev) => ({ ...prev, color: { ...prev.color, ...patch } }));
  const updateDraftVignette = (value) => setDraft((prev) => ({ ...prev, vignette: value }));
  const updateDraftChromaKey = (patch) => setDraft((prev) => ({ ...prev, chromaKey: { ...prev.chromaKey, ...patch } }));
  const updateDraftTransition = (value) => setDraft((prev) => ({ ...prev, transitionOut: value }));
  const updateDraftAudio = (patch) => setDraft((prev) => ({ ...prev, audio: { ...prev.audio, ...patch } }));
  const updateDraftText = (patch) => setDraft((prev) => ({ ...prev, text: { ...prev.text, ...patch } }));

  const keyframeButtonFor = (prop) => {
    const points = selectedClip?.keyframes?.[prop];
    const active = Boolean(findKeyframeNear(points, clipLocalTime));
    const hasAny = Boolean(points?.length);
    return (
      <KeyframeButton
        active={active}
        hasAny={hasAny}
        onClick={() => toggleKeyframe(prop)}
        title={active ? 'Remove keyframe at this point in the clip' : 'Add a keyframe at this point in the clip'}
      />
    );
  };

  const speedKeyframeButton = () => {
    const points = selectedClip?.keyframes?.speed;
    const active = selectedClip ? Boolean(findKeyframeNear(points, speedSourceLocalTime(selectedClip))) : false;
    const hasAny = Boolean(points?.length);
    return (
      <KeyframeButton
        active={active}
        hasAny={hasAny}
        onClick={toggleSpeedKeyframe}
        title={active ? 'Remove speed point at this point in the clip' : 'Add a speed point at this point in the clip - add more to build a speed curve'}
      />
    );
  };

  const signed = (n, digits = 0) => `${n > 0 ? '+' : ''}${Number(n).toFixed(digits)}`;
  const kelvin = (temperature) => `${Math.round(6500 + temperature * 35)}K`;
  const isVideoClip = !disabled && selectedClip?.type === 'video';
  const isVisualClip = !disabled && isVideoLikeClip(selectedClip);
  const outputDuration = selectedClip ? clipOutputDuration(selectedClip) : 0;

  // The one property with the most keyframes, for the "◆ Keyframes on
  // Scale · 3" summary row.
  const keyframeSummary = (() => {
    if (!selectedClip?.keyframes) return null;
    const names = { scaleX: 'Scale', opacity: 'Opacity', rotation: 'Rotation', x: 'Position X', y: 'Position Y', volume: 'Volume', speed: 'Speed' };
    let best = null;
    Object.entries(names).forEach(([prop, label]) => {
      const count = selectedClip.keyframes[prop]?.length || 0;
      if (count && (!best || count > best.count)) best = { label, count };
    });
    return best;
  })();

  const colorSection = (
    <section className="st-insp-section">
      <h3 className="st-insp-title">Color</h3>
      <div className="st-chips">
        {(showAllLooks ? COLOR_PRESETS : COLOR_PRESETS.filter((preset) => preset.featured)).map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`st-chip ${findMatchingPresetId(draft.color) === preset.id ? 'is-active' : ''}`}
            onClick={() => { updateDraftColor(preset.params); commitColor(preset.params); }}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" className="st-chip is-ghost" onClick={() => setShowAllLooks((v) => !v)}>
          {showAllLooks ? 'Fewer' : `+${COLOR_PRESETS.filter((preset) => !preset.featured).length} more`}
        </button>
      </div>
      <Slider label="Exposure" display={signed(draft.color.brightness / 100, 2)} min={-100} max={100} value={draft.color.brightness} onChange={(v) => updateDraftColor({ brightness: v })} onCommit={() => commitColor(draft.color)} />
      <Slider label="Contrast" display={signed(draft.color.contrast)} min={-100} max={100} value={draft.color.contrast} onChange={(v) => updateDraftColor({ contrast: v })} onCommit={() => commitColor(draft.color)} />
      <Slider label="Saturation" display={signed(draft.color.saturation)} min={-100} max={100} value={draft.color.saturation} onChange={(v) => updateDraftColor({ saturation: v })} onCommit={() => commitColor(draft.color)} />
      <Slider label="Temperature" display={kelvin(draft.color.temperature)} min={-100} max={100} value={draft.color.temperature} onChange={(v) => updateDraftColor({ temperature: v })} onCommit={() => commitColor(draft.color)} />
      <Slider label="Vignette" display={`${draft.vignette}%`} min={0} max={100} value={draft.vignette} onChange={updateDraftVignette} onCommit={() => commitVignette(draft.vignette)} />
      {!isAdjustmentClip && (
        <div className="st-keyframe-row">
          <span className="st-diamond" aria-hidden="true">◆</span>
          {keyframeSummary
            ? <span>Keyframes on {keyframeSummary.label} · {keyframeSummary.count}</span>
            : <span className="is-muted">No keyframes yet - click ◆ beside a value to add one</span>}
        </div>
      )}
    </section>
  );

  return (
    <aside className="right-panel st-inspector">
      <header className="st-insp-head">
        <h2 title={disabled ? 'Inspector' : clipName}>{disabled ? 'Inspector' : clipName}</h2>
      </header>

      {disabled ? (
        <div className="st-insp-empty">
          {selectedClipIds.length > 1 ? `${selectedClipIds.length} clips selected` : 'Select a clip to edit its properties'}
        </div>
      ) : (
        <div className="st-insp-body">
          <dl className="st-insp-card">
            <div><dt>Duration</dt><dd>{outputDuration.toFixed(2)}s</dd></div>
            <div><dt>Start</dt><dd>{formatTimecode(clipStartTime, fps)}</dd></div>
            <div><dt>Track</dt><dd>{describeTrack ? describeTrack(selectedClip) : '—'}</dd></div>
          </dl>

          {isTextClip && (
            <section className="st-insp-section">
              <label className="st-field-block">
                <span>Text</span>
                <textarea
                  className="st-textarea"
                  rows={3}
                  value={draft.text.content}
                  onChange={(event) => updateDraftText({ content: event.target.value })}
                  onBlur={() => commitText(draft.text)}
                  placeholder="Type your text..."
                />
              </label>
              <Slider label="Size" display={`${draft.text.fontSize} px`} min={16} max={160} value={draft.text.fontSize} onChange={(v) => updateDraftText({ fontSize: v })} onCommit={() => commitText(draft.text)} />
              <div className="st-field">
                <div className="st-field-head"><span>Color</span><span className="st-field-value">{draft.text.color}</span></div>
                <input className="st-color" type="color" value={draft.text.color} onChange={(event) => { updateDraftText({ color: event.target.value }); commitText({ ...draft.text, color: event.target.value }); }} />
              </div>
              <div className="st-field">
                <div className="st-field-head"><span>Align</span></div>
                <div className="st-segment">
                  {['left', 'center', 'right'].map((align) => (
                    <button key={align} type="button" className={draft.text.align === align ? 'is-active' : ''} onClick={() => { updateDraftText({ align }); commitText({ ...draft.text, align }); }}>
                      {align[0].toUpperCase() + align.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {isVisualClip && (
            <section className="st-insp-section">
              <Slider
                label="Scale"
                display={`${draft.basic.scale}%`}
                min={10}
                max={200}
                value={draft.basic.scale}
                onChange={(v) => updateDraftBasic({ scale: v })}
                onCommit={() => commitBasic(draft.basic)}
                keyframe={(
                  <KeyframeButton
                    active={Boolean(findKeyframeNear(selectedClip?.keyframes?.scaleX, clipLocalTime))}
                    hasAny={Boolean(selectedClip?.keyframes?.scaleX?.length)}
                    onClick={toggleScaleKeyframe}
                    title="Add/remove a scale keyframe here - two or more animate a zoom"
                  />
                )}
              />
              <Slider label="Opacity" display={`${draft.basic.opacity}%`} min={0} max={100} value={draft.basic.opacity} onChange={(v) => updateDraftBasic({ opacity: v })} onCommit={() => commitBasic(draft.basic)} keyframe={keyframeButtonFor('opacity')} />
              {isVideoClip && (
                <>
                  <Slider
                    label="Volume"
                    display={volumeDb(draft.audio.volume)}
                    min={0}
                    max={200}
                    value={draft.audio.volume}
                    onChange={(v) => updateDraftAudio({ volume: v })}
                    onCommit={() => commitAudio(draft.audio)}
                    keyframe={(
                      <KeyframeButton
                        active={Boolean(findKeyframeNear(selectedClip?.keyframes?.volume, clipLocalTime))}
                        hasAny={Boolean(selectedClip?.keyframes?.volume?.length)}
                        onClick={toggleVolumeKeyframe}
                        title="Add/remove a volume keyframe here"
                      />
                    )}
                  />
                  <Slider label="Speed" display={`${draft.speed.toFixed(1)}×`} min={0.1} max={4} step={0.1} value={draft.speed} onChange={(v) => setDraft((prev) => ({ ...prev, speed: v }))} onCommit={() => commitSpeed(draft.speed)} keyframe={speedKeyframeButton()} />
                </>
              )}
            </section>
          )}

          {isAudioClip && (
            <section className="st-insp-section">
              <Slider
                label="Volume"
                display={volumeDb(draft.audio.volume)}
                min={0}
                max={200}
                value={draft.audio.volume}
                onChange={(v) => updateDraftAudio({ volume: v })}
                onCommit={() => commitAudio(draft.audio)}
                keyframe={(
                  <KeyframeButton
                    active={Boolean(findKeyframeNear(selectedClip?.keyframes?.volume, clipLocalTime))}
                    hasAny={Boolean(selectedClip?.keyframes?.volume?.length)}
                    onClick={toggleVolumeKeyframe}
                    title="Add/remove a volume keyframe here"
                  />
                )}
              />
              <Slider label="Speed" display={`${draft.speed.toFixed(1)}×`} min={0.1} max={4} step={0.1} value={draft.speed} onChange={(v) => setDraft((prev) => ({ ...prev, speed: v }))} onCommit={() => commitSpeed(draft.speed)} keyframe={speedKeyframeButton()} />
            </section>
          )}

          {(isVisualClip || isAdjustmentClip) && colorSection}

          {isVisualClip && (
            <Collapsible title="Transform">
              <Slider label="Rotation" display={`${draft.basic.rotation}°`} min={-180} max={180} value={draft.basic.rotation} onChange={(v) => updateDraftBasic({ rotation: v })} onCommit={() => commitBasic(draft.basic)} keyframe={keyframeButtonFor('rotation')} />
              <Slider label="Position X" display={`${Math.round(draft.basic.x)}%`} min={-100} max={100} value={draft.basic.x} onChange={(v) => updateDraftBasic({ x: v })} onCommit={() => commitBasic(draft.basic)} keyframe={keyframeButtonFor('x')} />
              <Slider label="Position Y" display={`${Math.round(draft.basic.y)}%`} min={-100} max={100} value={draft.basic.y} onChange={(v) => updateDraftBasic({ y: v })} onCommit={() => commitBasic(draft.basic)} keyframe={keyframeButtonFor('y')} />
              <div className="st-field">
                <div className="st-field-head"><span>Flip</span></div>
                <div className="st-segment">
                  <button type="button" className={draft.basic.flipH ? 'is-active' : ''} onClick={() => { const next = { ...draft.basic, flipH: !draft.basic.flipH }; updateDraftBasic(next); commitBasic(next); }}>↔ Horizontal</button>
                  <button type="button" className={draft.basic.flipV ? 'is-active' : ''} onClick={() => { const next = { ...draft.basic, flipV: !draft.basic.flipV }; updateDraftBasic(next); commitBasic(next); }}>↕ Vertical</button>
                </div>
              </div>
              <div className="st-field">
                <div className="st-field-head"><span>Animate</span><span className="st-field-value">{hasMotionKeyframes ? 'Camera move' : 'None'}</span></div>
                <div className="st-chips">
                  {MOTION_PRESETS.map((preset) => (
                    <button key={preset.id} type="button" className="st-chip" title={`Animate this clip across its full length - ${preset.label.toLowerCase()}`} onClick={() => applyMotion(preset.id)}>{preset.label}</button>
                  ))}
                  <button type="button" className={`st-chip ${hasMotionKeyframes ? '' : 'is-active'}`} onClick={() => applyMotion(null)}>None</button>
                </div>
              </div>
            </Collapsible>
          )}

          {isVisualClip && nextVideoClip && (
            <Collapsible title="Transition" badge={draft.transitionOut > 0 ? activeTransitionLabel : null}>
              <Slider label="Length" display={draft.transitionOut > 0 ? `${draft.transitionOut.toFixed(1)}s` : 'None'} min={0} max={maxTransitionDuration} step={0.1} value={Math.min(draft.transitionOut, maxTransitionDuration)} onChange={updateDraftTransition} onCommit={() => commitTransition(draft.transitionOut)} />
              {draft.transitionOut > 0 && (
                <div className="st-chips">
                  {TRANSITION_TYPES.map((t) => (
                    <button key={t.id} type="button" className={`st-chip ${activeTransitionType === t.id ? 'is-active' : ''}`} onClick={() => commitTransition(draft.transitionOut, t.id)}>{t.label}</button>
                  ))}
                </div>
              )}
            </Collapsible>
          )}

          {(isVideoClip || isAudioClip) && (
            <Collapsible title={isAudioClip ? 'Audio' : 'Audio & speed'}>
              <Slider label="Fade in" display={`${draft.audio.fadeIn.toFixed(1)}s`} min={0} max={3} step={0.1} value={draft.audio.fadeIn} onChange={(v) => updateDraftAudio({ fadeIn: v })} onCommit={() => commitAudio(draft.audio)} />
              <Slider label="Fade out" display={`${draft.audio.fadeOut.toFixed(1)}s`} min={0} max={3} step={0.1} value={draft.audio.fadeOut} onChange={(v) => updateDraftAudio({ fadeOut: v })} onCommit={() => commitAudio(draft.audio)} />
              <Toggle label="Mute" checked={draft.audio.muted} onChange={() => { const next = { ...draft.audio, muted: !draft.audio.muted }; updateDraftAudio(next); commitAudio(next); }} />
              {isAudioClip && (
                <>
                  <Toggle label="Auto-duck under other audio" checked={draft.audio.duckEnabled} onChange={() => { const next = { ...draft.audio, duckEnabled: !draft.audio.duckEnabled }; updateDraftAudio(next); commitAudio(next); }} />
                  {draft.audio.duckEnabled && (
                    <Slider label="Duck amount" display={`${draft.audio.duckAmount}%`} min={0} max={100} value={draft.audio.duckAmount} onChange={(v) => updateDraftAudio({ duckAmount: v })} onCommit={() => commitAudio(draft.audio)} />
                  )}
                </>
              )}
              <div className="st-field">
                <div className="st-field-head"><span>Speed presets</span></div>
                <div className="st-segment">
                  {[1, 2, 4].map((value) => (
                    <button key={value} type="button" className={value === Math.round(draft.speed) ? 'is-active' : ''} onClick={() => { setDraft((prev) => ({ ...prev, speed: value })); commitSpeed(value); }}>
                      {value === 1 ? 'Normal' : `${value}×`}
                    </button>
                  ))}
                </div>
              </div>
              {selectedClip?.keyframes?.speed?.length > 0 && (
                <p className="st-note">Speed curve: {selectedClip.keyframes.speed.length} point{selectedClip.keyframes.speed.length === 1 ? '' : 's'}. Move the playhead and use ◆ beside Speed to add more.</p>
              )}
            </Collapsible>
          )}

          {isVisualClip && (
            <Collapsible title="Chroma key" badge={draft.chromaKey.enabled ? 'On' : null}>
              <Toggle
                label="Remove a background color"
                checked={draft.chromaKey.enabled}
                onChange={() => {
                  const next = { ...draft.chromaKey, enabled: !draft.chromaKey.enabled };
                  updateDraftChromaKey(next);
                  commitChromaKey(next);
                }}
              />
              {draft.chromaKey.enabled && (
                <>
                  <div className="st-field">
                    <div className="st-field-head"><span>Key color</span><span className="st-field-value">{draft.chromaKey.color}</span></div>
                    <div className="st-swatches">
                      <input className="st-color" type="color" value={draft.chromaKey.color} onChange={(event) => { const next = { ...draft.chromaKey, color: event.target.value }; updateDraftChromaKey(next); commitChromaKey(next); }} />
                      {CHROMA_KEY_PRESETS.map((preset) => (
                        <button key={preset.color} type="button" className={`st-swatch ${draft.chromaKey.color === preset.color ? 'is-active' : ''}`} style={{ background: preset.color }} title={preset.label} aria-label={preset.label} onClick={() => { const next = { ...draft.chromaKey, color: preset.color }; updateDraftChromaKey(next); commitChromaKey(next); }} />
                      ))}
                    </div>
                  </div>
                  <Slider label="Similarity" display={`${draft.chromaKey.similarity}%`} min={1} max={100} value={draft.chromaKey.similarity} onChange={(v) => updateDraftChromaKey({ similarity: v })} onCommit={() => commitChromaKey(draft.chromaKey)} />
                  <Slider label="Edge softness" display={`${draft.chromaKey.blend}%`} min={0} max={100} value={draft.chromaKey.blend} onChange={(v) => updateDraftChromaKey({ blend: v })} onCommit={() => commitChromaKey(draft.chromaKey)} />
                </>
              )}
            </Collapsible>
          )}

          <Collapsible title="Clip">
            {!isTextClip && !isAudioClip && !isAdjustmentClip && (
              <>
                <Toggle label="Enabled (off = skipped in preview and export)" checked={selectedClip?.enabled !== false} onChange={() => updateClip(selectedClipId, (clip) => ({ ...clip, enabled: clip.enabled === false }))} />
                <Toggle label="Play in reverse" checked={Boolean(selectedClip?.reversed)} onChange={() => updateClip(selectedClipId, (clip) => ({ ...clip, reversed: !clip.reversed }))} />
              </>
            )}
            <div className="st-field">
              <div className="st-field-head"><span>Label color on timeline</span></div>
              <div className="st-swatches">
                <button type="button" className={`st-swatch is-default ${!selectedClip?.color ? 'is-active' : ''}`} title="Default" aria-label="Default color" onClick={() => updateClip(selectedClipId, (clip) => ({ ...clip, color: null }))} />
                {CLIP_COLOR_PRESETS.map((swatch) => (
                  <button key={swatch} type="button" className={`st-swatch ${selectedClip?.color === swatch ? 'is-active' : ''}`} style={{ background: swatch }} title={swatch} aria-label={`Color ${swatch}`} onClick={() => updateClip(selectedClipId, (clip) => ({ ...clip, color: swatch }))} />
                ))}
              </div>
            </div>
          </Collapsible>
        </div>
      )}
    </aside>
  );
}

export default RightPanel;
