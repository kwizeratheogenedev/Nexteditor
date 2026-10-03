import path from 'path';

// Files a running job is still reading. The hourly sweep in server.js deletes
// uploads by age alone, and a montage or long export on a small server can
// run past that hour - deleting its source video mid-render ("No such file or
// directory" from ffmpeg). A job holds its inputs for as long as it runs;
// the sweep leaves held files alone.

const holds = new Map(); // resolved path -> number of jobs holding it

// Returns a function that releases the hold (safe to call more than once).
export function holdFiles(filePaths) {
  const resolved = [...new Set(filePaths.filter((p) => typeof p === 'string' && p).map((p) => path.resolve(p)))];
  resolved.forEach((p) => holds.set(p, (holds.get(p) || 0) + 1));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resolved.forEach((p) => {
      const count = (holds.get(p) || 0) - 1;
      if (count > 0) holds.set(p, count);
      else holds.delete(p);
    });
  };
}

export function isFileHeld(filePath) {
  return holds.has(path.resolve(filePath));
}
