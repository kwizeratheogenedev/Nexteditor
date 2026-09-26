// The media-bin item currently being dragged. HTML drag-and-drop only lets
// the drop target read the dragged data on drop, not while hovering - but
// the timeline wants the item's length and kind while hovering, to draw the
// ghost clip where it will land. The bin sets this on dragstart and clears
// it on dragend.
export const MEDIA_DRAG_TYPE = 'application/x-nexeditor-media';

let current = null;

export function setMediaDrag(item) {
  current = item;
}

export function getMediaDrag() {
  return current;
}
