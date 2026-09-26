import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Where uploaded media (uploads/) and job outputs (clips/) are written.
//
// - STORAGE_DIR set: under that folder (e.g. a mounted persistent disk).
// - Normal server / local dev: backend/uploads and backend/clips, as always.
// - Vercel (or any host whose code folder is read-only): the code folder
//   can't be written to and only the temp dir can, so they go under
//   <tmp>/nexeditor there. Files in the temp dir last only as long as that
//   server instance.
const backendDir = path.dirname(fileURLToPath(import.meta.url));

function makeDirs(root) {
  fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(root, 'clips'), { recursive: true });
  return root;
}

function resolveStorageRoot() {
  if (process.env.STORAGE_DIR) return makeDirs(path.resolve(process.env.STORAGE_DIR));
  const tempRoot = path.join(os.tmpdir(), 'nexeditor');
  if (process.env.VERCEL) return makeDirs(tempRoot);
  try {
    return makeDirs(backendDir);
  } catch (error) {
    console.warn(`[storage] ${backendDir} is not writable (${error.code}); using ${tempRoot} instead.`);
    return makeDirs(tempRoot);
  }
}

export const STORAGE_ROOT = resolveStorageRoot();
export const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
export const CLIPS_DIR = path.join(STORAGE_ROOT, 'clips');
