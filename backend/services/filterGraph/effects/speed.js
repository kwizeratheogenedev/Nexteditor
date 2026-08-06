// ffmpeg's atempo filter only accepts a factor in [0.5, 2.0] per instance -
// speeds outside that range must chain multiple atempo instances (e.g. a 4x
// speed-up is atempo=2.0,atempo=2.0). This resolves the exact chain of
// per-instance factors whose product equals the requested speed.
export function atempoFactors(speed) {
  if (!Number.isFinite(speed) || speed <= 0) return [1];
  const factors = [];
  let remaining = speed;
  if (remaining > 2) {
    while (remaining > 2) {
      factors.push(2);
      remaining /= 2;
    }
    factors.push(remaining);
  } else if (remaining < 0.5) {
    while (remaining < 0.5) {
      factors.push(0.5);
      remaining /= 0.5;
    }
    factors.push(remaining);
  } else {
    factors.push(remaining);
  }
  return factors;
}

export function applyVideoSpeed(graph, inputLabel, clip) {
  const speed = clip.speed || 1;
  if (Math.abs(speed - 1) < 0.001) return inputLabel;
  const out = graph.label('vspeed');
  graph.addNode(`setpts=PTS/${speed}`, inputLabel, out);
  return out;
}

export function applyAudioSpeed(graph, inputLabel, clip) {
  const speed = clip.speed || 1;
  if (Math.abs(speed - 1) < 0.001) return inputLabel;
  const out = graph.label('aspeed');
  const chain = atempoFactors(speed).map((factor) => `atempo=${factor.toFixed(4)}`).join(',');
  graph.addNode(chain, inputLabel, out);
  return out;
}
