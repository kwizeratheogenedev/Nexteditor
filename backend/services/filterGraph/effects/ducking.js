// Automatically lowers (ducks) `mainLabel`'s volume whenever `sidechainLabel`
// has audio present, via ffmpeg's native sidechaincompress filter - the same
// building block real DAWs use for "music ducks under dialogue". Input order
// matters: sidechaincompress's inputs are #0 main, #1 sidechain (verified
// against the bundled ffmpeg build's `-h filter=sidechaincompress`).
// `amount` (0-100, from the audio clip's Audio tab) maps onto threshold/
// ratio - higher amount trips at quieter sidechain levels and squashes
// harder. attack/release are fixed at values that dip promptly when speech
// starts but don't pump/flutter between words.
export function applyDucking(graph, mainLabel, sidechainLabel, amount) {
  const clamped = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  const ratio = 2 + clamped * 18; // ffmpeg range [1, 20]
  // Linear threshold mapping barely engaged real program audio (empirically
  // verified: a continuous full-scale sine sidechain against threshold=0.095
  // only pulled the main track down ~2dB) - RMS-detected program levels sit
  // much lower than a naive 0-1 amplitude range suggests. Exponential from
  // 0.3 (near-inert) down to ffmpeg's floor of ~0.001 gives a duck that's
  // subtle at low `amount` and a strong, clearly audible dip at high
  // `amount` (verified: amount=50 -> ~8dB dip, amount=90 -> ~21dB dip,
  // against the same test signal).
  const threshold = 0.3 * Math.pow(0.02, clamped);
  const out = graph.label('duck');
  graph.addNode(
    `sidechaincompress=threshold=${threshold.toFixed(4)}:ratio=${ratio.toFixed(2)}:attack=15:release=300:makeup=1`,
    [mainLabel, sidechainLabel],
    out,
  );
  return out;
}
