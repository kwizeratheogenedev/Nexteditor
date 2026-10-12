// Which video each montage clip comes from. Instead of always 1,2,3,1,2,3,
// the clips go in rounds that use every video once, each round in a new
// order - e.g. 1,2,3 then 3,1,2 then 2,3,1 ... - so montages made from the
// same videos come out in different orders. Rules:
//   - never two clips from the same video in a row, also where one round
//     meets the next (a round never starts with the video the last one
//     ended on);
//   - with 3+ videos, a round never repeats the order of the one before.
// With 2 videos the first rule allows only 1,2,1,2 (or 2,1,2,1).
//
// The same rules are copied in frontend/src/montage/local/planClips.js, so
// Server 1 and Server 2 cut montages alike.

function shuffled(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function nextRound(count, previous, random) {
  const indices = Array.from({ length: count }, (_, i) => i);
  if (!previous || count < 2) return shuffled(indices, random);
  const sameOrder = (round) => round.every((v, i) => v === previous[i]);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const round = shuffled(indices, random);
    if (round[0] === previous[count - 1]) continue;
    if (count > 2 && sameOrder(round)) continue;
    return round;
  }
  // Practically unreachable; shifting the last round by one always fits.
  return previous.slice(1).concat(previous[0]);
}

// Returns next(): the video index for each clip, in order.
export function createClipOrder(videoCount, random = Math.random) {
  let round = [];
  let position = 0;
  return () => {
    if (position >= round.length) {
      round = nextRound(videoCount, round.length ? round : null, random);
      position = 0;
    }
    const index = round[position];
    position += 1;
    return index;
  };
}
