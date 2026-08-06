import { applyAudioTrim } from './trim.js';
import { applyAudioSpeed } from './speed.js';
import { applyAudioLevels } from './audio.js';
import { hasSpeedCurve, applyAudioSpeedCurve } from './speedCurve.js';

// Builds one standalone audio-track clip's stream: trim/speed/volume-levels
// (reusing the exact same building blocks the video track's own audio uses),
// then `adelay` to push it out to wherever this clip sits on the audio
// track's own sequential mini-timeline (same positioning rule as the text
// track - see index.js's audio-track loop and
// frontend/src/timeline/keyframes.js getAudioClipStartTime, which this
// mirrors). `startTime` is in seconds; adelay wants milliseconds.
export function buildAudioTrackClip(graph, inputLabel, clip, outputDuration, startTime) {
  let audio = hasSpeedCurve(clip)
    ? applyAudioSpeedCurve(graph, inputLabel, clip)
    : applyAudioSpeed(graph, applyAudioTrim(graph, inputLabel, clip), clip);
  audio = applyAudioLevels(graph, audio, clip, outputDuration);

  const delayMs = Math.round(Math.max(0, startTime) * 1000);
  if (delayMs > 0) {
    const out = graph.label('adelay');
    graph.addNode(`adelay=${delayMs}:all=1`, audio, out);
    audio = out;
  }

  return audio;
}
