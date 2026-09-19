import { useEffect, useMemo, useRef, useState } from 'react';
import './LongMixPanel.css';
import { MOTION_PRESETS } from '../timeline/motionPresets';
import {
  SCENE_MODES,
  DEFAULT_LONGMIX_SETTINGS,
  createLongMixEntry,
  formatTimestamp,
  formatChapters,
} from '../timeline/longMix';

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MixIcon = ({ children }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

// Probing an audio file's real length needs a decoded <audio> element (a
// <video> element's duration on a pure-audio file is unreliable across
// browsers - the same reason App.jsx's addAudioFileToTimeline uses one).
// Resolves 0 rather than rejecting on an unreadable file, so one bad MP3 in
// a folder of fifty doesn't sink the whole import.
function probeAudioDuration(url) {
  return new Promise((resolve) => {
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
    probe.load();
  });
}

function probeVideoDuration(url) {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
    probe.load();
  });
}

// The output frame, as preset ids the backend re-derives real pixel
// dimensions from (see timeline/canvasPresets.js and exportTimeline.js's
// resolveCanvas). A mix is a YouTube upload in practice, so landscape leads;
// 720p is here because a 90-minute render at 1080p is a long wait. 4K is
// deliberately absent - it's a Pro-only resolution the export would reject,
// and an hour of it would take most of a day.
// Frame rate of the rendered video. The render time is almost entirely
// per-frame work, so this is the biggest speed control there is.
const FRAME_RATES = [
  { id: 15, label: 'Fast · 15 fps', hint: 'Slideshow-smooth, renders about 1.6x faster than 30 fps' },
  { id: 30, label: 'Smooth · 30 fps', hint: 'Full frame rate - slower to render' },
];

const VIDEO_SIZES = [
  { id: '1080p', label: '1080p · 16:9', resolutionId: '1080p', aspectRatioId: '16:9', hint: 'Standard YouTube upload' },
  { id: '720p', label: '720p · 16:9', resolutionId: '720p', aspectRatioId: '16:9', hint: 'Renders roughly twice as fast' },
  { id: 'square', label: '1080p · 1:1', resolutionId: '1080p', aspectRatioId: '1:1', hint: 'Square, for feed posts' },
];

// The wizard is a sequence, not four independent tabs: each step says what
// it wants, whether it has it yet, and what the next one is. A step can
// only be opened once every step before it is satisfied, so there's no way
// to land on Create with no songs and be left guessing why the button does
// nothing. Going back is always allowed - revisiting Songs after a render
// and making another version is normal use, not an error.
const STEPS = [
  {
    id: 'songs',
    label: 'Songs',
    title: 'Add your songs',
    guide: 'Pick the tracks for this mix, in the order they should play. Drag them into order with the arrows, and click a title to rename it - that name becomes its YouTube chapter.',
    isDone: ({ songs }) => songs.length > 0,
    blockedHint: 'Add at least one song to continue.',
  },
  {
    id: 'scenes',
    label: 'Background',
    title: 'Add background scenes',
    guide: 'These play behind the music. One image is enough for a whole mix - add more if you want the picture to change as the tracks do. Stills get a slow camera move so the video never looks frozen.',
    isDone: ({ scenes }) => scenes.length > 0,
    blockedHint: 'Add at least one background image or clip to continue.',
  },
  {
    id: 'settings',
    label: 'Settings',
    title: 'Set the mix up',
    guide: 'How the tracks join, how often the picture changes, and which way the camera moves. The defaults are sensible - skip straight to Create if you are happy with them.',
    isDone: () => true,
  },
  {
    id: 'build',
    label: 'Create',
    title: 'Create the video',
    guide: 'This renders the whole mix on the server and hands back a finished video to preview and download. A long mix takes a while, so leave the tab open while it runs.',
    isDone: ({ result }) => Boolean(result),
  },
];

function LongMixPanel({
  songs,
  setSongs,
  scenes,
  setScenes,
  settings,
  setSettings,
  onCreate,
  building = false,
  progress = 0,
  progressText = '',
  result = null,
  resultUrl = '',
  onDownload,
  chapters = [],
  runtime = 0,
  onOpenEditor,
  onError,
}) {
  const [activeStep, setActiveStep] = useState('songs');
  const [copied, setCopied] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const songInputRef = useRef(null);
  const sceneInputRef = useRef(null);

  // Everything the steps' own isDone/blockedHint rules need to judge
  // themselves against - kept in one object so a step definition never
  // reaches into component state directly.
  const progressState = { songs, scenes, result };
  const stepIndex = STEPS.findIndex((step) => step.id === activeStep);
  const currentStep = STEPS[stepIndex] || STEPS[0];
  const previousStep = STEPS[stepIndex - 1] || null;
  const nextStep = STEPS[stepIndex + 1] || null;
  // A step is reachable when every step before it is satisfied. The first
  // unsatisfied step is as far forward as the user can go.
  const isReachable = (index) => STEPS.slice(0, index).every((step) => step.isDone(progressState));
  const canLeaveCurrentStep = currentStep.isDone(progressState);

  const goToStep = (id) => {
    const index = STEPS.findIndex((step) => step.id === id);
    if (index < 0 || !isReachable(index)) return;
    setActiveStep(id);
  };

  // Emptying an earlier step (removing the last song from Build, say) can
  // strand the user on a step that no longer holds together - walk them
  // back to the first one that still needs attention rather than leaving a
  // dead panel on screen.
  useEffect(() => {
    if (isReachable(stepIndex)) return;
    const firstUnsatisfied = STEPS.findIndex((step) => !step.isDone(progressState));
    setActiveStep(STEPS[Math.max(0, firstUnsatisfied)].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs.length, scenes.length, stepIndex]);

  const totalSongSeconds = useMemo(
    () => songs.reduce((sum, song) => sum + (song.duration || 0), 0),
    [songs],
  );
  // What the mix will actually run to once the crossfades eat into it -
  // shown before building so the length isn't a surprise afterwards.
  const estimatedRuntime = useMemo(() => {
    const overlapTotal = Math.max(0, songs.length - 1) * (Number(settings.crossfade) || 0);
    const once = Math.max(0, totalSongSeconds - overlapTotal);
    const target = (Number(settings.targetMinutes) || 0) * 60;
    return target > 0 ? Math.max(once, target) : once;
  }, [songs.length, totalSongSeconds, settings.crossfade, settings.targetMinutes]);

  const addFiles = async (fileList, kind) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const entries = [];
    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const entryKind = kind === 'song' ? 'song' : (isImage ? 'image' : 'video');
      const entry = createLongMixEntry(file, entryKind, 0);
      // A still has no duration to probe - how long it stays on screen is
      // decided by the scene layout at build time, not by the file.
      if (entryKind === 'song') {
        entry.duration = await probeAudioDuration(entry.url);
        if (!entry.duration) {
          onError?.(`Couldn't read "${file.name}" - skipping it.`);
          continue;
        }
      } else if (entryKind === 'video') {
        entry.duration = await probeVideoDuration(entry.url);
      }
      entries.push(entry);
    }
    if (!entries.length) return;
    if (kind === 'song') setSongs((prev) => [...prev, ...entries]);
    else setScenes((prev) => [...prev, ...entries]);
  };

  const move = (list, setList, id, direction) => {
    setList((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const remove = (setList, id) => setList((prev) => prev.filter((item) => item.id !== id));

  const rename = (setList, id, title) => {
    setList((prev) => prev.map((item) => (item.id === id ? { ...item, title: title.trim() || item.title } : item)));
  };

  const copyChapters = async () => {
    try {
      await navigator.clipboard.writeText(formatChapters(chapters));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError?.('Couldn\'t reach the clipboard - select the chapter list and copy it manually.');
    }
  };

  const canCreate = songs.length > 0 && scenes.length > 0 && !building;
  const loopingEnabled = (Number(settings.targetMinutes) || 0) > 0;

  return (
    <div className="longmix-workspace">
      <header className="longmix-heading">
        <div>
          <span className="longmix-kicker">MUSIC · LONG FORM</span>
          <h1>LongMix Studio</h1>
          <p>Turn a folder of songs and a few background scenes into one long mix video, with chapters.</p>
        </div>
        <nav className="longmix-steps" aria-label="LongMix steps">
          {STEPS.map((step, index) => {
            const done = step.isDone(progressState);
            const reachable = isReachable(index);
            const isActive = activeStep === step.id;
            return (
              <button
                key={step.id}
                type="button"
                className={`${isActive ? 'is-active' : ''} ${done && !isActive ? 'is-done' : ''} ${reachable ? '' : 'is-locked'}`}
                aria-current={isActive ? 'step' : undefined}
                disabled={!reachable}
                title={reachable ? step.title : `Finish step ${index} first`}
                onClick={() => goToStep(step.id)}
              >
                <b>{done && !isActive ? '✓' : index + 1}</b> {step.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="longmix-main-grid">
        <section className="longmix-card">
          <div className="longmix-guide">
            <span className="longmix-guide-step">Step {stepIndex + 1} of {STEPS.length}</span>
            <strong>{currentStep.title}</strong>
            <p>{currentStep.guide}</p>
          </div>

          {activeStep === 'songs' && (
            <>
              <div className="longmix-card-head">
                <div>
                  <strong>Songs</strong>
                  <span>{songs.length ? `${songs.length} tracks · ${formatTimestamp(totalSongSeconds)} of music` : 'Add the tracks, in the order they should play'}</span>
                </div>
                <button type="button" onClick={() => songInputRef.current?.click()}>Add songs</button>
              </div>
              <input ref={songInputRef} type="file" accept="audio/*" multiple className="sr-only-input" onChange={(event) => { addFiles(event.target.files, 'song'); event.target.value = ''; }} />

              {songs.length === 0 ? (
                <button type="button" className="longmix-dropzone" onClick={() => songInputRef.current?.click()}>
                  <span><MixIcon><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></MixIcon></span>
                  <strong>Add your whole songs folder</strong>
                  <small>MP3, WAV, AAC or OGG · select as many as you like</small>
                  <b>Choose songs</b>
                </button>
              ) : (
                <ol className="longmix-list">
                  {songs.map((song, index) => (
                    <li key={song.id}>
                      <span className="longmix-index">{index + 1}</span>
                      {renamingId === song.id ? (
                        <input
                          className="longmix-rename"
                          autoFocus
                          defaultValue={song.title}
                          onBlur={(event) => { rename(setSongs, song.id, event.target.value); setRenamingId(null); }}
                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                        />
                      ) : (
                        // The song title IS the chapter title, so renaming
                        // here is how a chapter gets its name.
                        <button type="button" className="longmix-title" title="Rename - this becomes the chapter title" onClick={() => setRenamingId(song.id)}>
                          {song.title}
                        </button>
                      )}
                      <span className="longmix-duration">{formatTimestamp(song.duration)}</span>
                      <span className="longmix-row-actions">
                        <button type="button" title="Move up" onClick={() => move(songs, setSongs, song.id, -1)}>↑</button>
                        <button type="button" title="Move down" onClick={() => move(songs, setSongs, song.id, 1)}>↓</button>
                        <button type="button" title="Remove" onClick={() => remove(setSongs, song.id)}>✕</button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}

          {activeStep === 'scenes' && (
            <>
              <div className="longmix-card-head">
                <div>
                  <strong>Background scenes</strong>
                  <span>{scenes.length ? `${scenes.length} scenes` : 'Images or video clips to play behind the music'}</span>
                </div>
                <button type="button" onClick={() => sceneInputRef.current?.click()}>Add scenes</button>
              </div>
              <input ref={sceneInputRef} type="file" accept="image/*,video/*" multiple className="sr-only-input" onChange={(event) => { addFiles(event.target.files, 'scene'); event.target.value = ''; }} />

              {scenes.length === 0 ? (
                <button type="button" className="longmix-dropzone" onClick={() => sceneInputRef.current?.click()}>
                  <span><MixIcon><rect x="3" y="4" width="18" height="15" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 17 5-4 4 3 3-2 4 3" /></MixIcon></span>
                  <strong>Add background images or clips</strong>
                  <small>JPG, PNG, WebP or video · every still gets a slow camera move</small>
                  <b>Choose scenes</b>
                </button>
              ) : (
                <ul className="longmix-scene-grid">
                  {scenes.map((scene, index) => (
                    <li key={scene.id}>
                      <div className="longmix-scene-thumb">
                        {scene.kind === 'image'
                          ? <img src={scene.url} alt="" />
                          : <video src={scene.url} muted preload="metadata" />}
                        <span>{index + 1}</span>
                      </div>
                      <strong title={scene.title}>{scene.title}</strong>
                      <span className="longmix-row-actions">
                        <button type="button" title="Move earlier" onClick={() => move(scenes, setScenes, scene.id, -1)}>↑</button>
                        <button type="button" title="Move later" onClick={() => move(scenes, setScenes, scene.id, 1)}>↓</button>
                        <button type="button" title="Remove" onClick={() => remove(setScenes, scene.id)}>✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {activeStep === 'settings' && (
            <>
              <div className="longmix-card-head">
                <div><strong>Mix settings</strong><span>How the tracks join and how the picture changes</span></div>
              </div>

              <label className="longmix-field">
                <span>Crossfade between songs <b>{settings.crossfade.toFixed(1)}s</b></span>
                <input type="range" min="0" max="12" step="0.5" value={settings.crossfade} onChange={(event) => setSettings((prev) => ({ ...prev, crossfade: Number(event.target.value) }))} />
              </label>

              <div className="longmix-field">
                <span>Background scenes</span>
                <div className="longmix-choice-list">
                  {SCENE_MODES.map((mode) => (
                    <button key={mode.id} type="button" className={settings.sceneMode === mode.id ? 'is-active' : ''} onClick={() => setSettings((prev) => ({ ...prev, sceneMode: mode.id }))}>
                      <span>{settings.sceneMode === mode.id ? '●' : '○'}</span>
                      <div><strong>{mode.label}</strong><small>{mode.hint}</small></div>
                    </button>
                  ))}
                </div>
              </div>

              {settings.sceneMode === 'interval' && (
                <label className="longmix-field">
                  <span>Change scene every <b>{settings.sceneIntervalMinutes} min</b></span>
                  <input type="range" min="1" max="20" step="1" value={settings.sceneIntervalMinutes} onChange={(event) => setSettings((prev) => ({ ...prev, sceneIntervalMinutes: Number(event.target.value) }))} />
                </label>
              )}

              <div className="longmix-field">
                <span>Camera move on still scenes</span>
                <div className="longmix-choice-row">
                  {MOTION_PRESETS.map((preset) => (
                    <button key={preset.id} type="button" className={settings.motionPresetId === preset.id ? 'is-active' : ''} onClick={() => setSettings((prev) => ({ ...prev, motionPresetId: preset.id }))}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="longmix-field">
                <span>Video size</span>
                <div className="longmix-choice-row">
                  {VIDEO_SIZES.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      className={settings.resolutionId === size.resolutionId && settings.aspectRatioId === size.aspectRatioId ? 'is-active' : ''}
                      title={size.hint}
                      onClick={() => setSettings((prev) => ({ ...prev, resolutionId: size.resolutionId, aspectRatioId: size.aspectRatioId }))}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="longmix-field">
                <span>Frame rate</span>
                <div className="longmix-choice-row">
                  {FRAME_RATES.map((rate) => (
                    <button
                      key={rate.id}
                      type="button"
                      className={settings.fps === rate.id ? 'is-active' : ''}
                      title={rate.hint}
                      onClick={() => setSettings((prev) => ({ ...prev, fps: rate.id }))}
                    >
                      {rate.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="longmix-field">
                <span>Repeat the playlist to reach <b>{loopingEnabled ? `${settings.targetMinutes} min` : 'off'}</b></span>
                <input type="range" min="0" max="1440" step="15" value={settings.targetMinutes} onChange={(event) => setSettings((prev) => ({ ...prev, targetMinutes: Number(event.target.value) }))} />
              </label>

              {loopingEnabled && (
                <div className="longmix-warning">
                  <MixIcon><path d="M12 9v4m0 4h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></MixIcon>
                  <span>Repeating the same tracks to pad out the runtime can fall foul of YouTube&apos;s repetitious/inauthentic content policy. Looping is fine for your own listening, but think twice before monetizing a mix built this way.</span>
                </div>
              )}
            </>
          )}

          {activeStep === 'build' && (
            <>
              {!result && (
                <>
                  <div className="longmix-card-head">
                    <div><strong>Ready to render</strong><span>Your files are uploaded and the mix is rendered on the server</span></div>
                  </div>

                  <ul className="longmix-summary">
                    <li><span>Songs</span><b>{songs.length}</b></li>
                    <li><span>Scenes</span><b>{scenes.length}</b></li>
                    <li><span>Video size</span><b>{settings.resolutionId} · {settings.aspectRatioId}</b></li>
                    <li><span>Runtime</span><b>{formatTimestamp(estimatedRuntime)}</b></li>
                  </ul>

                  {building && (
                    <div className="longmix-render-status">
                      <div className="longmix-progress"><span style={{ width: `${Math.max(2, progress)}%` }} /></div>
                      <strong>{Math.round(progress)}%</strong>
                      <small>{progressText || 'Rendering your mix…'}</small>
                    </div>
                  )}

                  <button type="button" className="longmix-build-button" disabled={!canCreate} onClick={onCreate}>
                    <MixIcon><path d="M8 5v14l11-7z" /></MixIcon>
                    {building ? `Creating your mix ${Math.round(progress)}%` : 'Create the video'}
                  </button>
                  <small className="longmix-hint">
                    {building
                      ? 'A long mix can take a while - leave this tab open until it finishes.'
                      : 'Nothing is uploaded until you press this.'}
                  </small>
                </>
              )}

              {result && (
                <div className="longmix-result">
                  <div className="longmix-card-head">
                    <div>
                      <strong>Your mix is ready</strong>
                      <span>{formatTimestamp(result.duration || runtime)} · {formatFileSize(result.size)} · {chapters.length} chapters</span>
                    </div>
                    <button type="button" onClick={onCreate} disabled={building}>Render again</button>
                  </div>

                  <video className="longmix-preview" src={resultUrl} controls preload="metadata" />

                  <div className="longmix-result-actions">
                    <button type="button" className="longmix-build-button" onClick={onDownload}>
                      <MixIcon><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></MixIcon>
                      Download video
                    </button>
                    {onOpenEditor && (
                      <button type="button" className="longmix-secondary-button" onClick={onOpenEditor}>
                        Open in the editor
                      </button>
                    )}
                  </div>
                  <small className="longmix-hint">Open it in the editor to hand-adjust anything - the same clips, on the normal timeline.</small>

                  <div className="longmix-chapter-block">
                    <div className="longmix-card-head">
                      <div><strong>YouTube chapters</strong><span>Paste these into your video description</span></div>
                      <button type="button" onClick={copyChapters}>{copied ? 'Copied ✓' : 'Copy chapters'}</button>
                    </div>
                    <pre className="longmix-chapters">{formatChapters(chapters)}</pre>
                  </div>
                </div>
              )}
            </>
          )}

          {/* The wizard's own navigation: always a way forward, and when
              there isn't one, the reason why. */}
          <div className="longmix-step-nav">
            <div>
              {previousStep && (
                <button type="button" className="longmix-nav-back" onClick={() => goToStep(previousStep.id)}>
                  ← {previousStep.label}
                </button>
              )}
            </div>
            <div className="longmix-nav-forward">
              {!canLeaveCurrentStep && currentStep.blockedHint && <small>{currentStep.blockedHint}</small>}
              {nextStep ? (
                <button
                  type="button"
                  className="longmix-nav-next"
                  disabled={!canLeaveCurrentStep}
                  onClick={() => goToStep(nextStep.id)}
                >
                  Next: {nextStep.label} →
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="longmix-side">
          <div className="longmix-card-head"><div><strong>The whole flow</strong><span>Four steps, then export</span></div></div>
          <ol className="longmix-flow">
            {STEPS.map((step, index) => {
              const done = step.isDone(progressState);
              const isActive = activeStep === step.id;
              return (
                <li key={step.id} className={`${isActive ? 'is-active' : ''} ${done ? 'is-done' : ''}`}>
                  <span className="longmix-flow-mark">{done ? '✓' : index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <small>
                      {step.id === 'songs' && (songs.length ? `${songs.length} tracks added` : 'Nothing added yet')}
                      {step.id === 'scenes' && (scenes.length ? `${scenes.length} scenes added` : 'Nothing added yet')}
                      {step.id === 'settings' && `${settings.crossfade.toFixed(1)}s crossfade · ${SCENE_MODES.find((m) => m.id === settings.sceneMode)?.label.toLowerCase()}`}
                      {step.id === 'build' && (result ? `Rendered · ${formatTimestamp(result.duration || runtime)}` : building ? `Rendering ${Math.round(progress)}%` : 'Not created yet')}
                    </small>
                  </div>
                </li>
              );
            })}
            <li className="longmix-flow-end">
              <span className="longmix-flow-mark">↓</span>
              <div><strong>Preview, download, publish</strong><small>Or open it in the editor to fine-tune</small></div>
            </li>
          </ol>
          {estimatedRuntime > 3600 && (
            <div className="longmix-warning">
              <MixIcon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></MixIcon>
              <span>A mix this long takes a while to export and needs the upload of every song, so keep the tab open once you start it.</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default LongMixPanel;
export { DEFAULT_LONGMIX_SETTINGS };
