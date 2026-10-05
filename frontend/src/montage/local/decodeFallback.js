// The device's video decoder (usually the graphics chip) can fail partway
// through a video it said it could read - common on older laptops and with
// some phone recordings - and the browser then reports only "Decoding
// error". When that happens the frames are read again from where they
// stopped with the browser's software decoder: slower, but it reads far
// more videos. Only if that fails too does the montage stop, with a message
// that says what to do.

export function isDecoderFailure(error) {
  if (!error || error.name === 'AbortError') return false;
  return error.name === 'EncodingError' || /decod/i.test(String(error.message || ''));
}

export class UnreadableVideoError extends Error {
  constructor(label, fileName) {
    super(`${label} (${fileName}) couldn't be read by this computer's video decoder. Use Server 1 instead - it reads the video on our server.`);
    this.name = 'UnreadableVideoError';
  }
}

// Yields one frame (or null when there is none at that time) per timestamp,
// like CanvasSink.canvasesAtTimestamps.
//   source: { sink, software, label, fileName, makeSink(software) } - updated
//           in place when it switches to software decoding, so later clips
//           from the same video keep using it.
//   onSwitch: called when switching, e.g. to tell the user it's slower now.
export async function* framesWithFallback(source, timestamps, { onSwitch } = {}) {
  let delivered = 0;
  for (;;) {
    try {
      for await (const frame of source.sink.canvasesAtTimestamps(timestamps.slice(delivered))) {
        delivered += 1;
        yield frame;
      }
      return;
    } catch (error) {
      if (!isDecoderFailure(error)) throw error;
      if (source.software) throw new UnreadableVideoError(source.label, source.fileName);
      console.warn(`Hardware decoding failed for ${source.fileName}; retrying with software decoding.`, error);
      source.software = true;
      source.sink = source.makeSink(true);
      onSwitch?.();
    }
  }
}
