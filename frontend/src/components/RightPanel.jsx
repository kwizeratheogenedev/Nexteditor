import { useEffect, useMemo, useState } from 'react';
import { useEditorTimeline, useEditorPlayback, useSelectedEditorClip } from '../context/EditorStateContext';
import { resolveKeyframedValue, upsertKeyframe, removeKeyframeNear, findKeyframeNear, getClipStartTime } from '../timeline/keyframes';
import { COLOR_PRESETS, findMatchingPresetId } from '../timeline/colorPresets';
import { expectedTransitionStart, TRANSITION_TYPES, clipDuration as clipOutputDuration } from '../timeline/transitions';
import { hasSpeedCurve, sourceTimeForOutputElapsed, currentSegmentSpeed } from '../timeline/speedCurve';
import { MOTION_PRESETS, applyMotionPreset, clearMotionPreset } from '../timeline/motionPresets';
import { isVideoLikeClip, isImageClip } from '../timeline/clipKinds';

function PropertyRow({ label, value, keyframeButton, children }) {
  return (
    <div className="property-row">
      <div className="property-row-head">
        <span className="property-label">{label}</span>
        <span className="property-value">{value}</span>
      </div>
      <div className="property-row-control">
        {children}
        {keyframeButton}
      </div>
    </div>
  );
}

function KeyframeButton({ active, hasAny, onClick, disabled, title }) {
  return (
    <button
      type="button"
      className={`keyframe-toggle ${active ? 'is-active' : ''} ${hasAny ? 'has-keyframes' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      ◆
    </button>
  );
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

const VIDEO_TABS = [['basic', 'Basic'], ['color', 'Color'], ['speed', 'Speed'], ['audio', 'Audio']];
// A still image carries no audio stream and nothing to play faster or
// slower - its on-screen length is set by dragging its trim handles - so it
// gets the transform/color half of the video tabs.
const IMAGE_TABS = [['basic', 'Basic'], ['color', 'Color']];
const TEXT_TABS = [['text', 'Text']];
const AUDIO_TABS = [['audio', 'Audio'], ['speed', 'Speed']];
// Adjustment layers (M13) carry no media/transform/speed/audio of their
// own - only their color/vignette filters matter, same params a regular
// clip's Color tab edits.
const ADJUSTMENT_TABS = [['color', 'Color']];

function RightPanel() {
  const { timeline, selectedClipId, selectedClipIds, updateClip, commitTimeline } = useEditorTimeline();
  const { playhead } = useEditorPlayback();
  const selectedClip = useSelectedEditorClip();
  const isTextClip = selectedClip?.type === 'text';
  const isAudioClip = selectedClip?.type === 'audio';
  const isAdjustmentClip = selectedClip?.type === 'adjustment';
  const isImageClipSelected = isImageClip(selectedClip);
  const [activePanel, setActivePanel] = useState('basic');

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

  // Jump to the tab set that's actually relevant to the newly-selected
  // clip's type, rather than leaving a video-only tab active over a text or
  // audio clip's panel (or vice versa).
  useEffect(() => {
    setActivePanel(isTextClip ? 'text' : isAudioClip ? 'audio' : isAdjustmentClip ? 'color' : 'basic');
  }, [selectedClipId, isTextClip, isAudioClip, isAdjustmentClip]);

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
        disabled={disabled}
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
        disabled={disabled}
        active={active}
        hasAny={hasAny}
        onClick={toggleSpeedKeyframe}
        title={active ? 'Remove speed point at this point in the clip' : 'Add a speed point at this point in the clip - add more to build a speed curve'}
      />
    );
  };

  return (
    <aside className="right-panel">
      <div className="inspector-tabs">
        {(isTextClip ? TEXT_TABS : isAudioClip ? AUDIO_TABS : isAdjustmentClip ? ADJUSTMENT_TABS : isImageClipSelected ? IMAGE_TABS : VIDEO_TABS).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`inspector-tab ${activePanel === id ? 'is-active' : ''}`}
            onClick={() => setActivePanel(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`inspector-body ${disabled ? 'is-disabled' : ''}`}>
        <div className="property-row">
          <div className="property-row-head">
            <span className="property-label">Clip</span>
            <span className="property-value">{clipName}</span>
          </div>
          <div style={{ padding: '0 4px', fontSize: 12, color: 'var(--text-muted)' }}>
            {selectedClipIds.length > 1 ? `${selectedClipIds.length} clips selected` : disabled ? 'Select a clip to edit its properties' : `Duration: ${clipDuration.toFixed(2)}s`}
          </div>
        </div>
        {!disabled && (
          <PropertyRow label="Clip color" value="">
            <div className="swatch-row">
              <button
                type="button"
                className={`color-swatch ${!selectedClip?.color ? 'is-active' : ''}`}
                style={{ background: 'var(--timeline-clip-video, #3b82f6)' }}
                title="Default (by clip type)"
                onClick={() => updateClip(selectedClipId, (clip) => ({ ...clip, color: null }))}
              />
              {CLIP_COLOR_PRESETS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`color-swatch ${selectedClip?.color === swatch ? 'is-active' : ''}`}
                  style={{ background: swatch }}
                  title={swatch}
                  onClick={() => updateClip(selectedClipId, (clip) => ({ ...clip, color: swatch }))}
                />
              ))}
            </div>
          </PropertyRow>
        )}
        {activePanel === 'basic' && (
          <>
            <PropertyRow
              label="Scale"
              value={`${draft.basic.scale}%`}
              keyframeButton={(
                <KeyframeButton
                  disabled={disabled}
                  active={Boolean(findKeyframeNear(selectedClip?.keyframes?.scaleX, clipLocalTime))}
                  hasAny={Boolean(selectedClip?.keyframes?.scaleX?.length)}
                  onClick={toggleScaleKeyframe}
                  title="Add/remove a scale keyframe at this point in the clip - two or more animate a zoom"
                />
              )}
            >
              <input disabled={disabled} type="range" min="10" max="200" value={draft.basic.scale} onChange={(event) => updateDraftBasic({ scale: Number(event.target.value) })} onMouseUp={() => commitBasic(draft.basic)} onTouchEnd={() => commitBasic(draft.basic)} onBlur={() => commitBasic(draft.basic)} />
            </PropertyRow>
            <PropertyRow label="Opacity" value={`${draft.basic.opacity}%`} keyframeButton={keyframeButtonFor('opacity')}>
              <input disabled={disabled} type="range" min="0" max="100" value={draft.basic.opacity} onChange={(event) => updateDraftBasic({ opacity: Number(event.target.value) })} onMouseUp={() => commitBasic(draft.basic)} onTouchEnd={() => commitBasic(draft.basic)} onBlur={() => commitBasic(draft.basic)} />
            </PropertyRow>
            <PropertyRow label="Rotation" value={`${draft.basic.rotation}°`} keyframeButton={keyframeButtonFor('rotation')}>
              <input disabled={disabled} type="range" min="-180" max="180" value={draft.basic.rotation} onChange={(event) => updateDraftBasic({ rotation: Number(event.target.value) })} onMouseUp={() => commitBasic(draft.basic)} onTouchEnd={() => commitBasic(draft.basic)} onBlur={() => commitBasic(draft.basic)} />
            </PropertyRow>
            <PropertyRow label="Position X" value={`${Math.round(draft.basic.x)}%`} keyframeButton={keyframeButtonFor('x')}>
              <input disabled={disabled} type="range" min="-100" max="100" value={draft.basic.x} onChange={(event) => updateDraftBasic({ x: Number(event.target.value) })} onMouseUp={() => commitBasic(draft.basic)} onTouchEnd={() => commitBasic(draft.basic)} onBlur={() => commitBasic(draft.basic)} />
            </PropertyRow>
            <PropertyRow label="Position Y" value={`${Math.round(draft.basic.y)}%`} keyframeButton={keyframeButtonFor('y')}>
              <input disabled={disabled} type="range" min="-100" max="100" value={draft.basic.y} onChange={(event) => updateDraftBasic({ y: Number(event.target.value) })} onMouseUp={() => commitBasic(draft.basic)} onTouchEnd={() => commitBasic(draft.basic)} onBlur={() => commitBasic(draft.basic)} />
            </PropertyRow>
            <PropertyRow label="Flip" value="">
              <div className="toggle-pair">
                <button disabled={disabled} type="button" className={`mini-toggle ${draft.basic.flipH ? 'is-active' : ''}`} onClick={() => { const next = { ...draft.basic, flipH: !draft.basic.flipH }; updateDraftBasic(next); commitBasic(next); }}>↔ H</button>
                <button disabled={disabled} type="button" className={`mini-toggle ${draft.basic.flipV ? 'is-active' : ''}`} onClick={() => { const next = { ...draft.basic, flipV: !draft.basic.flipV }; updateDraftBasic(next); commitBasic(next); }}>↕ V</button>
              </div>
            </PropertyRow>
            {!isTextClip && !isAudioClip && (
              <PropertyRow label="Clip" value="">
                <div className="toggle-pair">
                  <button
                    disabled={disabled}
                    type="button"
                    className={`mini-toggle ${selectedClip?.enabled !== false ? 'is-active' : ''}`}
                    title="Disabled clips are skipped in preview and export without being deleted"
                    onClick={() => updateClip(selectedClipId, (clip) => ({ ...clip, enabled: clip.enabled === false }))}
                  >
                    {selectedClip?.enabled !== false ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    disabled={disabled}
                    type="button"
                    className={`mini-toggle ${selectedClip?.reversed ? 'is-active' : ''}`}
                    title="Play this clip's trimmed range backward"
                    onClick={() => updateClip(selectedClipId, (clip) => ({ ...clip, reversed: !clip.reversed }))}
                  >
                    Reverse
                  </button>
                </div>
              </PropertyRow>
            )}
            {nextVideoClip && (
              <PropertyRow label="Transition Out" value={draft.transitionOut > 0 ? `${draft.transitionOut.toFixed(1)}s ${activeTransitionLabel}` : 'None'}>
                <input disabled={disabled} type="range" min="0" max={maxTransitionDuration} step="0.1" value={Math.min(draft.transitionOut, maxTransitionDuration)} onChange={(event) => updateDraftTransition(Number(event.target.value))} onMouseUp={() => commitTransition(draft.transitionOut)} onTouchEnd={() => commitTransition(draft.transitionOut)} onBlur={() => commitTransition(draft.transitionOut)} />
              </PropertyRow>
            )}
            {nextVideoClip && draft.transitionOut > 0 && (
              <PropertyRow label="Transition Type" value={activeTransitionLabel}>
                <div className="toggle-pair">
                  {TRANSITION_TYPES.map((t) => (
                    <button
                      key={t.id}
                      disabled={disabled}
                      type="button"
                      className={`mini-toggle ${activeTransitionType === t.id ? 'is-active' : ''}`}
                      onClick={() => commitTransition(draft.transitionOut, t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </PropertyRow>
            )}
            {!disabled && isVideoLikeClip(selectedClip) && (
              <PropertyRow label="Animate" value={hasMotionKeyframes ? 'Camera move' : 'None'}>
                <div className="toggle-pair" style={{ flexWrap: 'wrap' }}>
                  {MOTION_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="mini-toggle"
                      title={`Animate this clip across its full length - ${preset.label.toLowerCase()}`}
                      onClick={() => applyMotion(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`mini-toggle ${hasMotionKeyframes ? '' : 'is-active'}`}
                    title="Remove the camera move (scale and position keyframes) from this clip"
                    onClick={() => applyMotion(null)}
                  >
                    None
                  </button>
                </div>
              </PropertyRow>
            )}
            {!disabled && (
              <div className="caption-info-box" style={{ marginTop: 4 }}>
                <span>Click ◆ next to Scale, Opacity, Rotation or Position to animate it - add a keyframe at the current playhead position, move the playhead, then change the value to animate between them. Animate applies a ready-made move across the whole clip, which you can then edit the same way.</span>
              </div>
            )}
          </>
        )}

        {activePanel === 'color' && (
          <>
            <PropertyRow label="Brightness" value={`${draft.color.brightness}`}>
              <input disabled={disabled} type="range" min="-100" max="100" value={draft.color.brightness} onChange={(event) => updateDraftColor({ brightness: Number(event.target.value) })} onMouseUp={() => commitColor(draft.color)} onTouchEnd={() => commitColor(draft.color)} onBlur={() => commitColor(draft.color)} />
            </PropertyRow>
            <PropertyRow label="Contrast" value={`${draft.color.contrast}`}>
              <input disabled={disabled} type="range" min="-100" max="100" value={draft.color.contrast} onChange={(event) => updateDraftColor({ contrast: Number(event.target.value) })} onMouseUp={() => commitColor(draft.color)} onTouchEnd={() => commitColor(draft.color)} onBlur={() => commitColor(draft.color)} />
            </PropertyRow>
            <PropertyRow label="Saturation" value={`${draft.color.saturation}`}>
              <input disabled={disabled} type="range" min="-100" max="100" value={draft.color.saturation} onChange={(event) => updateDraftColor({ saturation: Number(event.target.value) })} onMouseUp={() => commitColor(draft.color)} onTouchEnd={() => commitColor(draft.color)} onBlur={() => commitColor(draft.color)} />
            </PropertyRow>
            <PropertyRow label="Temperature" value={`${draft.color.temperature}`}>
              <input disabled={disabled} type="range" min="-100" max="100" value={draft.color.temperature} onChange={(event) => updateDraftColor({ temperature: Number(event.target.value) })} onMouseUp={() => commitColor(draft.color)} onTouchEnd={() => commitColor(draft.color)} onBlur={() => commitColor(draft.color)} />
            </PropertyRow>
            <PropertyRow label="Vignette" value={`${draft.vignette}%`}>
              <input disabled={disabled} type="range" min="0" max="100" value={draft.vignette} onChange={(event) => updateDraftVignette(Number(event.target.value))} onMouseUp={() => commitVignette(draft.vignette)} onTouchEnd={() => commitVignette(draft.vignette)} onBlur={() => commitVignette(draft.vignette)} />
            </PropertyRow>
            <PropertyRow label="Presets" value="">
              <div className="swatch-row">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={disabled}
                    className={`color-swatch ${findMatchingPresetId(draft.color) === preset.id ? 'is-active' : ''}`}
                    style={{ background: preset.swatch }}
                    title={preset.label}
                    onClick={() => { updateDraftColor(preset.params); commitColor(preset.params); }}
                  />
                ))}
              </div>
            </PropertyRow>
            {!isAdjustmentClip && (
              <>
                <PropertyRow label="Chroma Key" value={draft.chromaKey.enabled ? 'On' : 'Off'}>
                  <div className="toggle-pair">
                    <button
                      disabled={disabled}
                      type="button"
                      className={`mini-toggle ${draft.chromaKey.enabled ? 'is-active' : ''}`}
                      onClick={() => {
                        const next = { ...draft.chromaKey, enabled: !draft.chromaKey.enabled };
                        updateDraftChromaKey(next);
                        commitChromaKey(next);
                      }}
                    >
                      {draft.chromaKey.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </PropertyRow>
                {draft.chromaKey.enabled && (
                  <>
                    <PropertyRow label="Key Color" value={draft.chromaKey.color}>
                      <input
                        disabled={disabled}
                        type="color"
                        value={draft.chromaKey.color}
                        onChange={(event) => {
                          const next = { ...draft.chromaKey, color: event.target.value };
                          updateDraftChromaKey(next);
                          commitChromaKey(next);
                        }}
                      />
                    </PropertyRow>
                    <div className="swatch-row">
                      {CHROMA_KEY_PRESETS.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          disabled={disabled}
                          className={`color-swatch ${draft.chromaKey.color === preset.color ? 'is-active' : ''}`}
                          style={{ background: preset.color }}
                          title={preset.label}
                          onClick={() => {
                            const next = { ...draft.chromaKey, color: preset.color };
                            updateDraftChromaKey(next);
                            commitChromaKey(next);
                          }}
                        />
                      ))}
                    </div>
                    <PropertyRow label="Similarity" value={`${draft.chromaKey.similarity}%`}>
                      <input disabled={disabled} type="range" min="1" max="100" value={draft.chromaKey.similarity} onChange={(event) => updateDraftChromaKey({ similarity: Number(event.target.value) })} onMouseUp={() => commitChromaKey(draft.chromaKey)} onTouchEnd={() => commitChromaKey(draft.chromaKey)} onBlur={() => commitChromaKey(draft.chromaKey)} />
                    </PropertyRow>
                    <PropertyRow label="Edge Softness" value={`${draft.chromaKey.blend}%`}>
                      <input disabled={disabled} type="range" min="0" max="100" value={draft.chromaKey.blend} onChange={(event) => updateDraftChromaKey({ blend: Number(event.target.value) })} onMouseUp={() => commitChromaKey(draft.chromaKey)} onTouchEnd={() => commitChromaKey(draft.chromaKey)} onBlur={() => commitChromaKey(draft.chromaKey)} />
                    </PropertyRow>
                    <div className="caption-info-box" style={{ marginTop: 4 }}>
                      <span>Removes the key color from this clip. Raise Similarity to catch more shades of the color, raise Edge Softness to feather the cutout edge.</span>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {activePanel === 'speed' && (
          <>
            <PropertyRow label="Speed" value={`${draft.speed.toFixed(1)}×`} keyframeButton={speedKeyframeButton()}>
              <input disabled={disabled} type="range" min="0.1" max="4" step="0.1" value={draft.speed} onChange={(event) => setDraft((prev) => ({ ...prev, speed: Number(event.target.value) }))} onMouseUp={() => commitSpeed(draft.speed)} onTouchEnd={() => commitSpeed(draft.speed)} onBlur={() => commitSpeed(draft.speed)} />
            </PropertyRow>
            <div className="toggle-pair">
              {['1', '2', '4'].map((value) => (
                <button
                  disabled={disabled}
                  key={value}
                  type="button"
                  className={`mini-toggle ${Number(value) === Math.round(draft.speed) ? 'is-active' : ''}`}
                  onClick={() => { setDraft((prev) => ({ ...prev, speed: Number(value) })); commitSpeed(Number(value)); }}
                >
                  {value === '1' ? 'Normal' : `${value}×`}
                </button>
              ))}
            </div>
            {!disabled && selectedClip?.keyframes?.speed?.length > 0 && (
              <div className="caption-info-box" style={{ marginTop: 4 }}>
                Speed curve: {selectedClip.keyframes.speed.length} point{selectedClip.keyframes.speed.length === 1 ? '' : 's'} - move the playhead and use the diamond to add more, or drag the slider to edit the point nearest the playhead.
              </div>
            )}
          </>
        )}

        {activePanel === 'audio' && (
          <>
            <PropertyRow
              label="Volume"
              value={`${draft.audio.volume}%`}
              keyframeButton={(
                <KeyframeButton
                  disabled={disabled}
                  active={Boolean(findKeyframeNear(selectedClip?.keyframes?.volume, clipLocalTime))}
                  hasAny={Boolean(selectedClip?.keyframes?.volume?.length)}
                  onClick={toggleVolumeKeyframe}
                  title="Add/remove a volume keyframe at this point in the clip"
                />
              )}
            >
              <input disabled={disabled} type="range" min="0" max="200" value={draft.audio.volume} onChange={(event) => updateDraftAudio({ volume: Number(event.target.value) })} onMouseUp={() => commitAudio(draft.audio)} onTouchEnd={() => commitAudio(draft.audio)} onBlur={() => commitAudio(draft.audio)} />
            </PropertyRow>
            {!disabled && (selectedClip?.keyframes?.volume?.length > 0) && (
              <div className="caption-info-box" style={{ marginTop: 4 }}>
                <span>Volume is animated - click ◆ at the current playhead position to add or remove a keyframe, then change Volume to animate between points.</span>
              </div>
            )}
            <PropertyRow label="Fade In" value={`${draft.audio.fadeIn.toFixed(1)}s`}>
              <input disabled={disabled} type="range" min="0" max="3" step="0.1" value={draft.audio.fadeIn} onChange={(event) => updateDraftAudio({ fadeIn: Number(event.target.value) })} onMouseUp={() => commitAudio(draft.audio)} onTouchEnd={() => commitAudio(draft.audio)} onBlur={() => commitAudio(draft.audio)} />
            </PropertyRow>
            <PropertyRow label="Fade Out" value={`${draft.audio.fadeOut.toFixed(1)}s`}>
              <input disabled={disabled} type="range" min="0" max="3" step="0.1" value={draft.audio.fadeOut} onChange={(event) => updateDraftAudio({ fadeOut: Number(event.target.value) })} onMouseUp={() => commitAudio(draft.audio)} onTouchEnd={() => commitAudio(draft.audio)} onBlur={() => commitAudio(draft.audio)} />
            </PropertyRow>
            <PropertyRow label="Mute" value="">
              <button disabled={disabled} type="button" className={`mini-toggle ${draft.audio.muted ? 'is-active' : ''}`} onClick={() => { const next = { ...draft.audio, muted: !draft.audio.muted }; updateDraftAudio(next); commitAudio(next); }}>
                {draft.audio.muted ? 'Muted' : 'Mute'}
              </button>
            </PropertyRow>
            {isAudioClip && (
              <>
                <PropertyRow label="Auto-duck" value={draft.audio.duckEnabled ? 'On' : 'Off'}>
                  <button
                    disabled={disabled}
                    type="button"
                    className={`mini-toggle ${draft.audio.duckEnabled ? 'is-active' : ''}`}
                    onClick={() => { const next = { ...draft.audio, duckEnabled: !draft.audio.duckEnabled }; updateDraftAudio(next); commitAudio(next); }}
                  >
                    {draft.audio.duckEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </PropertyRow>
                {draft.audio.duckEnabled && (
                  <>
                    <PropertyRow label="Duck Amount" value={`${draft.audio.duckAmount}%`}>
                      <input disabled={disabled} type="range" min="0" max="100" value={draft.audio.duckAmount} onChange={(event) => updateDraftAudio({ duckAmount: Number(event.target.value) })} onMouseUp={() => commitAudio(draft.audio)} onTouchEnd={() => commitAudio(draft.audio)} onBlur={() => commitAudio(draft.audio)} />
                    </PropertyRow>
                    <div className="caption-info-box" style={{ marginTop: 4 }}>
                      <span>Automatically lowers this track under dialogue and any other audio in the mix. Raise Duck Amount for a harder, more noticeable dip.</span>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {activePanel === 'text' && (
          <>
            <PropertyRow label="Content" value="">
              <textarea
                disabled={disabled}
                className="text-content-input"
                rows={3}
                value={draft.text.content}
                onChange={(event) => updateDraftText({ content: event.target.value })}
                onBlur={() => commitText(draft.text)}
                placeholder="Type your text..."
              />
            </PropertyRow>
            <PropertyRow label="Size" value={`${draft.text.fontSize}px`}>
              <input disabled={disabled} type="range" min="16" max="160" value={draft.text.fontSize} onChange={(event) => updateDraftText({ fontSize: Number(event.target.value) })} onMouseUp={() => commitText(draft.text)} onTouchEnd={() => commitText(draft.text)} onBlur={() => commitText(draft.text)} />
            </PropertyRow>
            <PropertyRow label="Color" value={draft.text.color}>
              <input disabled={disabled} type="color" value={draft.text.color} onChange={(event) => { updateDraftText({ color: event.target.value }); commitText({ ...draft.text, color: event.target.value }); }} />
            </PropertyRow>
            <PropertyRow label="Align" value="">
              <div className="toggle-pair">
                {['left', 'center', 'right'].map((align) => (
                  <button
                    disabled={disabled}
                    key={align}
                    type="button"
                    className={`mini-toggle ${draft.text.align === align ? 'is-active' : ''}`}
                    onClick={() => { updateDraftText({ align }); commitText({ ...draft.text, align }); }}
                  >
                    {align[0].toUpperCase() + align.slice(1)}
                  </button>
                ))}
              </div>
            </PropertyRow>
          </>
        )}
      </div>
    </aside>
  );
}

export default RightPanel;
