import fs from 'fs';
import os from 'os';
import path from 'path';
import { runFFmpeg, probeDuration } from './ffmpeg.js';
import { planLongMix, SAMPLE_RATE, MOTION_PRESETS, STILL_MOTION } from './longMixPlan.js';

// LongMix Studio's own renderer. The general editor export (see
// filterGraph/index.js) builds ONE filter graph for the whole timeline and
// pushes every frame of it through a single-threaded pipeline: measured at
// 0.86x realtime for a 5-minute mix on a 14-core machine, so a two-hour mix
// took over two hours. A long mix is a much simpler thing than an arbitrary
// timeline - songs one after another, a slow camera move on a still - so it
// gets a purpose-built pipeline instead:
//
//  1. AUDIO, one cheap pass. The songs are laid end to end in the order they
//     were added, alternating between two lanes so consecutive songs can
//     overlap for the crossfade. Each lane is a plain concat (silence in
//     the gaps) and the two lanes are summed - linear in the mix length,
//     unlike delaying every song by hand and mixing them all together.
//  2. VIDEO, in parallel. The program is cut into independent chunks (each
//     scene, split into <=60s pieces, plus one short blend per scene
//     change) that render side by side on separate ffmpeg processes. The
//     camera move is `zoompan` on a single pre-scaled frame, refreshed at a
//     lower rate than the output frame rate and duplicated up - a slow drift
//     is indistinguishable and it halves the per-frame work.
//  3. ASSEMBLY, no re-encode. The chunks are joined with the concat demuxer
//     and muxed with the audio using stream copy.
//
// Because audio and video are laid out from the same integer sample/frame
// plan (longMixPlan.js), they cannot drift apart.

const MIN_MOTION_HZ = 3;
// Upper bound on how far any part of the picture travels over a scene, as a
// fraction of the frame width (the presets zoom by 15% or pan by ~16%), and
// the largest jump between two zoom updates we allow.
const MAX_TRAVEL_FRACTION = 0.16;
const MAX_STEP_PX = 1;
const CHUNK_SECONDS = 60;
// Pre-scale factor for the still, so zoompan's integer crop stays sub-pixel.
const PREP_SCALE = 2;
const AUDIO_WEIGHT = 0.1;
const VIDEO_WEIGHT = 0.85;

function envInt(name, fallback) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Each ffmpeg encode is itself multi-threaded, so a few at once already keep the
// machine busy; more just fight each other - and the audio mix, which is a
// single thread, has to keep pace with them (measured on a 14-core machine:
// 2-3 concurrent chunks rendered the video as fast as 5 and finished the whole
// mix sooner).
function defaultConcurrency() {
  return envInt('LONGMIX_CONCURRENCY', Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4))));
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function shorten(message) {
  const text = String(message || 'Render failed.');
  return text.length > 900 ? `...${text.slice(-900)}` : text;
}

// Short relative names in the work dir: keeps every ffmpeg command line far
// under Windows' length limit no matter how many songs a mix has (a looped
// playlist can put hundreds of inputs on one command).
function linkInto(workDir, sourcePath, name) {
  const target = path.join(workDir, name);
  try {
    fs.linkSync(sourcePath, target);
  } catch {
    fs.copyFileSync(sourcePath, target);
  }
  return name;
}

// ---------------------------------------------------------------- audio --

function buildAudioFilterScript(plan) {
  const lines = [];
  const lanes = [[], []];
  const laneCursor = [0, 0];
  const aformat = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;

  const silence = (samples, label) => {
    lines.push(`anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=end_sample=${samples},asetpts=PTS-STARTPTS,${aformat}[${label}]`);
    return label;
  };

  plan.songs.forEach((song, k) => {
    const lane = k % 2;
    const gap = song.start - laneCursor[lane];
    if (gap > 0) lanes[lane].push(silence(gap, `g${k}`));

    const seconds = song.samples / SAMPLE_RATE;
    const chain = [
      aformat,
      'asetpts=PTS-STARTPTS',
      `apad=whole_len=${song.samples}`,
      `atrim=end_sample=${song.samples}`,
    ];
    if (song.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${song.fadeIn.toFixed(4)}`);
    if (song.fadeOut > 0) chain.push(`afade=t=out:st=${Math.max(0, seconds - song.fadeOut).toFixed(4)}:d=${song.fadeOut.toFixed(4)}`);
    lines.push(`[${k}:a]${chain.join(',')}[s${k}]`);
    lanes[lane].push(`s${k}`);
    laneCursor[lane] = song.start + song.samples;
  });

  const laneLabels = [];
  lanes.forEach((items, lane) => {
    if (!items.length) return;
    if (items.length === 1) {
      laneLabels.push(items[0]);
      return;
    }
    const label = `lane${lane}`;
    lines.push(`${items.map((item) => `[${item}]`).join('')}concat=n=${items.length}:v=0:a=1[${label}]`);
    laneLabels.push(label);
  });

  if (laneLabels.length === 1) return { script: lines.join(';\n'), output: laneLabels[0] };
  lines.push(`[${laneLabels[0]}][${laneLabels[1]}]amix=inputs=2:duration=longest:normalize=0[aout]`);
  return { script: lines.join(';\n'), output: 'aout' };
}

async function renderAudio({ plan, workDir, songFiles, onProgress, signal, timeout }) {
  const { script, output } = buildAudioFilterScript(plan);
  fs.writeFileSync(path.join(workDir, 'audio.fc'), script);
  const inputs = plan.songs.flatMap((song) => ['-i', songFiles.get(song.song.sourceId)]);
  await runFFmpeg(
    [
      '-y', ...inputs,
      '-filter_complex_script', 'audio.fc',
      '-map', `[${output}]`,
      // The whole mixing graph runs at ~370x realtime; the AAC encoder is
      // where the audio time goes. Measured per 180s of audio: on transient-
      // heavy (beat) material the default settings ran at 13x realtime;
      // switching off mid/side and intensity stereo brings that to 30x (and
      // tonal pads from 25x to 45x) for ~4% bigger files. The `fast` coder is
      // NOT the answer - it's quicker on noisy audio but 2.7x SLOWER on
      // sustained tones, which is what ambient/house mixes are made of.
      '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE),
      '-aac_tns', '0', '-aac_pns', '0', '-aac_is', '0', '-aac_ms', '0',
      'mix.m4a',
    ],
    { duration: plan.totalSeconds, onProgress, cwd: workDir, signal, timeout },
  );
}

// ---------------------------------------------------------------- video --

function fitFilter(width, height, fitMode) {
  return fitMode === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
}

// How many output frames share one zoom position. What costs time is the
// number of DISTINCT frames (each one is a fresh zoom + a real encode; a
// repeated frame is nearly free), and a camera move that drifts a few hundred
// pixels over a multi-minute scene changes well under a pixel between
// updates - so refreshing it at the full frame rate is pure waste. Measured
// on a 60s 1080p chunk: 15 updates/s took 10.8s, 3 updates/s took 3.1s.
// The rate is picked per scene so the movement between updates stays around a
// pixel: long scenes (the normal case) get the minimum, a short scene with
// the same total travel gets faster updates.
function motionStep(fps, sceneFrames, width) {
  const seconds = Math.max(1, sceneFrames / fps);
  const travelPx = width * MAX_TRAVEL_FRACTION;
  const hz = Math.min(fps, Math.max(MIN_MOTION_HZ, travelPx / (MAX_STEP_PX * seconds)));
  return Math.max(1, Math.round(fps / hz));
}

// One scene's picture for a run of frames, as a filter chain that starts at
// input `inLabel` and ends at `outLabel`. `local0` is the scene-local frame
// the run begins at, so a chunk in the middle of a long scene continues the
// camera move exactly where the previous chunk stopped.
function sceneChain({ win, input, inLabel, outLabel, local0, count, canvas, fps, motion, fitMode }) {
  const sceneFrames = Math.max(1, win.endFrame - win.startFrame);
  if (win.scene.kind === 'video') {
    return `[${inLabel}]fps=${fps},${fitFilter(canvas.width, canvas.height, fitMode)},setsar=1,format=yuv420p[${outLabel}]`;
  }
  const step = motionStep(fps, sceneFrames, canvas.width);
  const p = `(${local0}+on*${step})/${sceneFrames}`;
  const zoom = `${motion.z0}+(${motion.z1}-${motion.z0})*${p}`;
  const panPx = `((${motion.x0})+((${motion.x1})-(${motion.x0}))*${p})*${canvas.width}/200`;
  const outFrames = Math.ceil(count / step) + 1;
  return `[${inLabel}]zoompan=z='${zoom}':x='iw/2-iw/zoom/2-(${panPx})*${PREP_SCALE}/zoom':y='ih/2-ih/zoom/2':d=${outFrames}:s=${canvas.width}x${canvas.height}:fps=${Math.round(fps / step)},fps=${fps},setsar=1,format=yuv420p[${outLabel}]`;
}

function inputArgsFor({ win, files, prepFiles, local0, fps }) {
  if (win.scene.kind === 'video') {
    const duration = Math.max(0.5, win.scene.duration || 1);
    const offset = ((local0 / fps) % duration).toFixed(3);
    return ['-stream_loop', '-1', '-ss', offset, '-i', files.get(win.scene.sourceId)];
  }
  return ['-i', prepFiles.get(win.scene.sourceId)];
}

function buildChunks(plan, fps) {
  const chunks = [];
  const maxFrames = CHUNK_SECONDS * fps;
  plan.sceneWindows.forEach((win, i) => {
    const next = plan.sceneWindows[i + 1];
    const coreStart = win.boundaryFrame;
    const coreEnd = win.endFrame - (next ? win.blendOut : 0);
    for (let f0 = coreStart; f0 < coreEnd; f0 += maxFrames) {
      chunks.push({ kind: 'core', win, f0, f1: Math.min(coreEnd, f0 + maxFrames) });
    }
    if (next && win.blendOut > 0) {
      chunks.push({ kind: 'blend', win, next, f0: coreEnd, f1: win.endFrame });
    }
  });
  return chunks;
}

// ultrafast, not the general export's veryfast: this picture is a slow drift
// over a still, so the encoder has almost nothing to find, and veryfast's
// extra analysis (b-frames, lookahead, CABAC) burned ~2.7x the CPU for a
// picture that measures the same (SSIM 0.9994 vs 0.9994 against a lossless
// reference). The file is only ~2 MB per minute either way.
function encodeArgs(fps) {
  return [
    '-an', '-c:v', 'libx264', '-preset', process.env.LONGMIX_ENCODE_PRESET || 'ultrafast',
    '-crf', process.env.LONGMIX_CRF || '21', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-g', String(fps * 2), '-sc_threshold', '0', '-video_track_timescale', String(fps * 1000),
  ];
}

async function renderChunk({ chunk, index, ctx }) {
  const { canvas, fps, files, prepFiles, motion, fitMode, workDir, signal } = ctx;
  const count = chunk.f1 - chunk.f0;
  const out = `seg_${String(index).padStart(6, '0')}.mp4`;
  const args = ['-y'];
  let graph;

  if (chunk.kind === 'core') {
    const local0 = chunk.f0 - chunk.win.startFrame;
    args.push(...inputArgsFor({ win: chunk.win, files, prepFiles, local0, fps }));
    graph = sceneChain({ win: chunk.win, inLabel: '0:v', outLabel: 'v', local0, count, canvas, fps, motion, fitMode });
  } else {
    const localA = chunk.f0 - chunk.win.startFrame;
    const localB = chunk.f0 - chunk.next.startFrame;
    args.push(...inputArgsFor({ win: chunk.win, files, prepFiles, local0: localA, fps }));
    args.push(...inputArgsFor({ win: chunk.next, files, prepFiles, local0: localB, fps }));
    const a = sceneChain({ win: chunk.win, inLabel: '0:v', outLabel: 'a', local0: localA, count, canvas, fps, motion, fitMode });
    const b = sceneChain({ win: chunk.next, inLabel: '1:v', outLabel: 'b', local0: localB, count, canvas, fps, motion, fitMode });
    graph = `${a};${b};[a][b]xfade=transition=fade:duration=${(count / fps).toFixed(4)}:offset=0,format=yuv420p[v]`;
  }

  args.push('-filter_complex', graph, '-map', '[v]', '-frames:v', String(count), ...encodeArgs(fps), out);
  await runFFmpeg(args, { cwd: workDir, signal, timeout: 30 * 60 * 1000, lowPriority: true });
  return out;
}

async function prepareStills({ plan, files, workDir, canvas, fitMode, signal }) {
  const prepFiles = new Map();
  const pw = canvas.width * PREP_SCALE;
  const ph = canvas.height * PREP_SCALE;
  const stills = [...new Map(plan.sceneWindows
    .filter((win) => win.scene.kind !== 'video')
    .map((win) => [win.scene.sourceId, win.scene])).values()];
  await runPool(stills, 4, async (scene, i) => {
    const out = `prep_${i}.bmp`;
    await runFFmpeg(
      ['-y', '-i', files.get(scene.sourceId), '-vf', fitFilter(pw, ph, fitMode), '-frames:v', '1', out],
      { cwd: workDir, signal, timeout: 5 * 60 * 1000 },
    );
    prepFiles.set(scene.sourceId, out);
  });
  return prepFiles;
}

// ----------------------------------------------------------------- main --

// songs:  [{ sourceId, title, path, clientDuration }] in the order added
// scenes: [{ sourceId, kind, path, clientDuration }]
// Returns { chapters, duration, songDurations } once `outputPath` is written.
export async function renderLongMix({ songs, scenes, settings, canvas, workDir, outputPath, onProgress }) {
  const controller = new AbortController();
  const { signal } = controller;
  const fps = canvas.fps;
  const fitMode = canvas.fitMode === 'cover' ? 'cover' : 'contain';
  const motion = MOTION_PRESETS[settings.motionPresetId] || STILL_MOTION;
  const startedAt = Date.now();
  const stamp = (label) => `${label} ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  const timings = [];

  try {
    const files = new Map();
    [...songs, ...scenes].forEach((item, i) => {
      if (!files.has(item.sourceId)) files.set(item.sourceId, linkInto(workDir, item.path, `src_${i}`));
    });

    // Real durations, measured - not whatever the browser reported.
    const measured = new Map();
    await runPool([...new Set(songs.map((song) => song.sourceId))], 8, async (sourceId) => {
      const song = songs.find((s) => s.sourceId === sourceId);
      let duration = 0;
      try {
        duration = await probeDuration(path.join(workDir, files.get(sourceId)));
      } catch { /* fall back to the client's number below */ }
      measured.set(sourceId, duration > 0 ? duration : song.clientDuration);
    });
    const measuredScenes = await Promise.all(scenes.map(async (scene) => {
      if (scene.kind !== 'video') return { ...scene, duration: 0 };
      let duration = 0;
      try {
        duration = await probeDuration(path.join(workDir, files.get(scene.sourceId)));
      } catch { /* leave 0 - treated as a 1s loop */ }
      return { ...scene, duration: duration || scene.clientDuration || 1 };
    }));

    const plan = planLongMix({
      songs: songs.map((song) => ({ sourceId: song.sourceId, title: song.title, duration: measured.get(song.sourceId) })),
      scenes: measuredScenes,
      settings,
      fps,
    });
    if (!plan.songs.length || !plan.totalSamples) throw new Error('The mix has no playable audio.');
    timings.push(stamp('probed'));

    const ctx = { canvas, fps, files, prepFiles: null, motion, fitMode, workDir, signal };
    let audioFraction = 0;
    let doneFrames = 0;
    const report = (text) => {
      const percent = (audioFraction * AUDIO_WEIGHT + (doneFrames / plan.totalFrames) * VIDEO_WEIGHT) * 100;
      onProgress(Math.min(99, percent), text);
    };

    const audioJob = renderAudio({
      plan,
      workDir,
      songFiles: files,
      signal,
      timeout: Math.max(60 * 60 * 1000, plan.totalSeconds * 1000),
      onProgress: (progress) => {
        audioFraction = progress.percent / 100;
        report('Mixing the songs...');
      },
    }).then(() => {
      audioFraction = 1;
      timings.push(stamp('audio done'));
      report('Songs mixed');
    });

    const videoJob = (async () => {
      ctx.prepFiles = await prepareStills({ plan, files, workDir, canvas, fitMode, signal });
      timings.push(stamp('stills ready'));
      const chunks = buildChunks(plan, fps);
      const segments = new Array(chunks.length);
      await runPool(chunks, defaultConcurrency(), async (chunk, index) => {
        segments[index] = await renderChunk({ chunk, index, ctx });
        doneFrames += chunk.f1 - chunk.f0;
        report('Rendering the background...');
      });
      fs.writeFileSync(
        path.join(workDir, 'segments.txt'),
        `ffconcat version 1.0\n${segments.map((name) => `file '${name}'`).join('\n')}\n`,
      );
      timings.push(stamp(`video done (${chunks.length} chunks)`));
    })();

    // If either half fails, stop the other one instead of leaving a
    // multi-process render running with nowhere to send its output.
    await Promise.all([audioJob, videoJob]).catch((error) => {
      controller.abort();
      throw error;
    });

    onProgress(97, 'Assembling the video...');
    await runFFmpeg(
      [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-i', 'mix.m4a',
        '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart',
        outputPath,
      ],
      { cwd: workDir, timeout: 60 * 60 * 1000 },
    );
    timings.push(stamp('assembled'));
    console.log(`LongMix render (${(plan.totalSeconds / 60).toFixed(1)} min, ${plan.songs.length} songs, ${canvas.width}x${canvas.height}): ${timings.join(' | ')}`);

    return {
      chapters: plan.chapters,
      duration: plan.totalSeconds,
      songDurations: Object.fromEntries(measured),
    };
  } catch (error) {
    controller.abort();
    throw new Error(shorten(error.message));
  }
}
