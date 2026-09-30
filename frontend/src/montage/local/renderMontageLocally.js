import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeVideo,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import { parseSkipSeconds, planClips } from './planClips.js';
import { createGradeRenderer, montageLook } from './gradeRenderer.js';

// Makes a Montage entirely in the browser: the videos and the song are read
// from the user's device, every frame is decoded and encoded with the
// device's own (usually hardware) video codecs through WebCodecs, and the
// finished MP4 is handed back as a Blob - nothing is uploaded.
//
// Output matches the server Montage: 1280x720 letterboxed, 30 fps, H.264,
// the whole song as the soundtrack, clips planned by the same rules.

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
// Hardware encoders are driven by bitrate rather than ffmpeg's CRF, so each
// quality setting maps to a bitrate that looks comparable at 720p while
// keeping files close to the server's sizes.
const VIDEO_BITRATE = { low: 2_000_000, medium: 3_500_000, high: 5_000_000, ultra: 8_000_000 };
const AUDIO_BITRATE = 192_000;

// What this browser can do. `ok: false` comes with the reason, shown to the
// user next to the "render on the server instead" button.
export async function checkLocalMontageSupport() {
  if (typeof window === 'undefined' || typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return { ok: false, reason: 'This browser cannot process video on the device (no WebCodecs support). Use a recent Chrome, Edge, Firefox or Safari.' };
  }
  if (typeof AudioEncoder === 'undefined') {
    return { ok: false, reason: 'This browser cannot encode audio on the device. Use a recent Chrome, Edge, Firefox or Safari 26+.' };
  }
  if (!document.createElement('canvas').getContext('webgl')) {
    return { ok: false, reason: 'WebGL is turned off in this browser, so the montage styles cannot be drawn.' };
  }
  const videoOk = await canEncodeVideo('avc', { width: WIDTH, height: HEIGHT, bitrate: VIDEO_BITRATE.high, frameRate: FPS });
  if (!videoOk) return { ok: false, reason: 'This browser cannot encode H.264 video on this device.' };
  // Firefox (and Linux) can't encode AAC; Opus in MP4 plays in browsers and
  // on YouTube.
  const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000, bitrate: AUDIO_BITRATE });
  if (!audioCodec) return { ok: false, reason: 'This browser cannot encode AAC or Opus audio on this device.' };
  return { ok: true, audioCodec };
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Montage cancelled.', 'AbortError');
}

async function openVideo(file, label) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack().catch(() => null);
  if (!track) {
    input.dispose();
    throw new Error(`${label} (${file.name}) has no video this browser can read.`);
  }
  if (!(await track.canDecode())) {
    const codec = (await track.getCodec()) || 'unknown';
    input.dispose();
    throw new Error(`${label} (${file.name}) uses a video format (${codec}) this browser cannot decode. Try another browser, or render on the server.`);
  }
  const [duration, firstTimestamp] = await Promise.all([input.computeDuration([track]), track.getFirstTimestamp()]);
  return { input, track, duration: duration - firstTimestamp, firstTimestamp };
}

async function decodeSong(file) {
  const bytes = await file.arrayBuffer();
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 48000 });
  try {
    return await context.decodeAudioData(bytes);
  } catch {
    throw new Error(`The song (${file.name}) is in a format this browser cannot decode. Try an MP3/M4A file, or render on the server.`);
  }
}

// onProgress({ percent, stage }) is called with real progress only:
// frames actually encoded out of the total.
export async function renderMontageLocally({ videoFiles, audioFile, settings, audioCodec, onProgress, signal }) {
  const report = (percent, stage) => onProgress?.({ percent: Math.max(0, Math.min(100, percent)), stage });
  const opened = [];
  let renderer = null;
  let output = null;

  try {
    report(0, 'Reading your files...');
    for (let i = 0; i < videoFiles.length; i += 1) {
      opened.push(await openVideo(videoFiles[i], `Video ${i + 1}`));
      assertNotAborted(signal);
    }
    report(0, 'Reading the song...');
    const song = await decodeSong(audioFile);
    assertNotAborted(signal);

    const clips = planClips({
      audioDuration: song.duration,
      videoDurations: opened.map((v) => v.duration),
      syncMode: settings.syncMode || 'beat',
      tempoSensitivity: settings.tempoSensitivity || 'medium',
      skipSeconds: parseSkipSeconds(settings.skipStartSeconds),
    });
    const totalFrames = Math.max(1, Math.round(song.duration * FPS));

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    renderer = createGradeRenderer(canvas, montageLook(settings));

    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: VIDEO_BITRATE[settings.videoQuality] || VIDEO_BITRATE.high,
      keyFrameInterval: 2,
    });
    const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: AUDIO_BITRATE });
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    output.addVideoTrack(videoSource, { frameRate: FPS });
    output.addAudioTrack(audioSource);
    await output.start();

    // The song is encoded alongside the video; the muxer interleaves them.
    const songDone = audioSource.add(song).then(() => audioSource.close());

    const sinks = opened.map((v) => new CanvasSink(v.track, { width: WIDTH, height: HEIGHT, fit: 'contain', poolSize: 2 }));
    let frameIndex = 0;
    let clipStart = 0;
    for (let c = 0; c < clips.length; c += 1) {
      const clip = clips[c];
      const clipEnd = clipStart + clip.clipDuration;
      // Frame boundaries from the running total, so rounding never drifts
      // the picture away from the song.
      const frames = Math.min(totalFrames, Math.round(clipEnd * FPS)) - frameIndex;
      clipStart = clipEnd;
      if (frames <= 0) continue;

      const source = opened[clip.sourceIndex];
      const timestamps = Array.from({ length: frames }, (_, k) => source.firstTimestamp + clip.startTime + k / FPS);
      const stage = `Rendering clip ${c + 1} of ${clips.length}`;
      let lastCanvas = null;
      for await (const wrapped of sinks[clip.sourceIndex].canvasesAtTimestamps(timestamps)) {
        assertNotAborted(signal);
        // Past the end of a short video the last frame simply holds.
        lastCanvas = wrapped?.canvas || lastCanvas;
        if (lastCanvas) renderer.draw(lastCanvas);
        await videoSource.add(frameIndex / FPS, 1 / FPS);
        frameIndex += 1;
        if (frameIndex % 5 === 0) report((frameIndex / totalFrames) * 97, stage);
      }
    }
    // The clip plan stops within 0.05 s of the song's end; hold the last
    // picture for those final frames so video and song end together.
    while (frameIndex < totalFrames) {
      await videoSource.add(frameIndex / FPS, 1 / FPS);
      frameIndex += 1;
    }
    videoSource.close();

    report(97, 'Adding the song...');
    await songDone;
    assertNotAborted(signal);
    report(99, 'Finishing the file...');
    await output.finalize();

    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    report(100, 'Complete');
    return { blob, duration: song.duration, size: blob.size, clips: clips.length, audioCodec };
  } catch (error) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => {});
    }
    throw error;
  } finally {
    renderer?.dispose();
    opened.forEach((v) => v.input.dispose());
  }
}
