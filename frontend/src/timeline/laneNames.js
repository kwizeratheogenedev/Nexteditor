// Track naming shared by the timeline headers and the inspector's "Track"
// field: a short code (V1, V2, T1, A1) plus a friendly name. Lane 0 of each
// type is the main one; a name the user typed (trackMeta[type][i].name)
// always wins over the default.
const CODE = { video: 'V', text: 'T', audio: 'A' };

export function laneCode(type, laneIndex) {
  return `${CODE[type] || '?'}${laneIndex + 1}`;
}

export function defaultLaneName(type, laneIndex) {
  if (type === 'video') return laneIndex === 0 ? 'Main' : laneIndex === 1 ? 'Overlay' : `Overlay ${laneIndex}`;
  if (type === 'audio') return laneIndex === 0 ? 'Music' : `Audio ${laneIndex + 1}`;
  return laneIndex === 0 ? 'Text' : `Text ${laneIndex + 1}`;
}

export function laneName(type, laneIndex, customName) {
  return (customName && String(customName).trim()) || defaultLaneName(type, laneIndex);
}
