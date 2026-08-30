import { useEffect, useMemo, useState } from 'react';
import { useEditorTimeline, useEditorPlayback, useSelectedEditorClip } from '../context/EditorStateContext';
import { resolveKeyframedValue, upsertKeyframe, removeKeyframeNear, findKeyframeNear, getClipStartTime } from '../timeline/keyframes';
import { COLOR_PRESETS, findMatchingPresetId } from '../timeline/colorPresets';
import { expectedTransitionStart } from '../timeline/transitions';
import { hasSpeedCurve, sourceTimeForOutputElapsed, currentSegmentSpeed } from '../timeline/speedCurve';

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
const DEFAULT_TEXT_STYLE = { content: '', fontFamily: 'Inter, sans-serif', fontSize: 64, color: '#ffffff', align: 'center' };
const DEFAULT_KEYFRAMES = { x: [], y: [], rotation: [], opacity: [], volume: [], speed: [] };
const KEYFRAME_PROPS = ['x', 'y', 'rotation', 'opacity'];

function findColorFilter(filters) {
  return (filters || []).find((filter) => filter.type === 'color') || { id: 'color', type: 'color', enabled: true, params: DEFAULT_COLOR_PARAMS };
}

function findVignetteFilter(filters) {
  return (filters || []).find((filter) => filter.type === 'vignette') || { id: 'vignette', type: 'vignette', enabled: true, params: { intensity: 0 } };
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
      speed: 1,
      audio: { volume: 100, fadeIn: 0, fadeOut: 0, muted: false },
      text: { ...DEFAULT_TEXT_STYLE },
      transitionOut: 0,
    };
  }
  const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const kf = { ...DEFAULT_KEYFRAMES, ...clip.keyframes };
  const color = { ...DEFAULT_COLOR_PARAMS, ...findColorFilter(clip.filters).params };
  const vignette = findVignetteFilter(clip.filters).params.intensity || 0;
  const opacity01 = resolveKeyframedValue(kf.opacity, clipLocalTime, t.opacity);
  return {
    basic: {
      scale: Math.round(Math.abs(t.scaleX) * 100),
      opacity: Math.round(opacity01 * 100),
      rotation: resolveKeyframedValue(kf.rotation, clipLocalTime, t.rotation),
      x: resolveKeyframedValue(kf.x, clipLocalTime, t.x),
      y: resolveKeyframedValue(kf.y, clipLocalTime, t.y),
      flipH: t.scaleX < 0,
      flipV: t.scaleY < 0,
    },
    color,
    vignette,
    // A curved clip's displayed speed tracks the segment active at the
    // playhead (mirrors how the volume envelope's slider shows the
    // interpolated value, not the flat field) - see timeline/speedCurve.js.
    speed: hasSpeedCurve(clip) ? currentSegmentSpeed(clip, clipLocalTime) : (typeof clip.speed === 'number' ? clip.speed : 1),
    audio: {
      volume: Math.round(resolveKeyframedValue(kf.volume, clipLocalTime, typeof clip.volume === 'number' ? clip.volume : 1) * 100),
      fadeIn: clip.audioFade?.in || 0,
      fadeOut: clip.audioFade?.out || 0,
      muted: Boolean(clip.muted),
    },
    text: { ...DEFAULT_TEXT_STYLE, ...clip.text },
    transitionOut: clip.transitionOut?.duration || 0,
  };
}

const VIDEO_TABS = [['basic', 'Basic'], ['color', 'Color'], ['speed', 'Speed'], ['audio', 'Audio']];
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
      .filter((clip) => (clip.type === 'video' || !clip.type) && (clip.trackIndex || 0) === (selectedClip.trackIndex || 0))
      .sort((a, b) => a.startTime - b.startTime);
    const index = laneClips.findIndex((clip) => clip.id === selectedClipId);
    if (index < 0) return null;
    return laneClips[index + 1] || null;
  }, [timeline, selectedClipId, selectedClip, isTextClip, isAudioClip]);
  const maxTransitionDuration = nextVideoClip
    ? Math.max(0.1, Math.min(3, clipDuration / (selectedClip.speed || 1), (nextVideoClip.trimmedEnd - nextVideoClip.trimmedStart) / (nextVideoClip.speed || 1)))
    : 0;

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

      // Scale/flip aren't keyframeable yet - always static.
      nextTransform.scaleX = (next.flipH ? -1 : 1) * (next.scale / 100);
      nextTransform.scaleY = (next.flipV ? -1 : 1) * (next.scale / 100);

      return { ...clip, transform: nextTransform, keyframes: nextKeyframes };
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

  // Sets/changes/clears the selected clip's transitionOut, and - in the
  // same commit - moves the adjacent next clip's startTime to match the new
  // overlap amount, since resolveActiveInLane only renders a transition
  // when the next clip actually sits at the expected overlap point (see
  // timeline/transitions.js). Both clips update atomically so Undo reverts
  // the whole edit in one step.
  const commitTransition = (duration) => {
    if (!selectedClipId || !nextVideoClip) return;
    const nextTransitionOut = duration > 0 ? { type: 'fade', duration } : null;
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
        {(isTextClip ? TEXT_TABS : isAudioClip ? AUDIO_TABS : isAdjustmentClip ? ADJUSTMENT_TABS : VIDEO_TABS).map(([id, label]) => (
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
            <PropertyRow label="Scale" value={`${draft.basic.scale}%`}>
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
              <PropertyRow label="Transition Out" value={draft.transitionOut > 0 ? `${draft.transitionOut.toFixed(1)}s Fade` : 'None'}>
                <input disabled={disabled} type="range" min="0" max={maxTransitionDuration} step="0.1" value={Math.min(draft.transitionOut, maxTransitionDuration)} onChange={(event) => updateDraftTransition(Number(event.target.value))} onMouseUp={() => commitTransition(draft.transitionOut)} onTouchEnd={() => commitTransition(draft.transitionOut)} onBlur={() => commitTransition(draft.transitionOut)} />
              </PropertyRow>
            )}
            {!disabled && (
              <div className="caption-info-box" style={{ marginTop: 4 }}>
                <span>Click ◆ next to Opacity, Rotation or Position to animate it - add a keyframe at the current playhead position, move the playhead, then change the value to animate between them.</span>
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
