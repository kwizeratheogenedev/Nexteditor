// The list of merges. It lives outside React so a merge keeps running when the
// user goes to another tab; the files only exist in this page, so closing or
// reloading it while one is running asks first.

// Each merge is a full CPU core's work; more than this at once slows them all
// down, so anything beyond it waits its turn.
const MAX_RUNNING = 3;

let jobs = [];
let nextId = 1;
const workers = new Map();
const listeners = new Set();

function publish(next) {
  jobs = next;
  listeners.forEach((listener) => listener());
}

const update = (id, patch) => publish(jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)));

function outputName(file) {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'audio';
  return `${base}-merge-8min`;
}

function finish(id, patch) {
  workers.get(id)?.terminate();
  workers.delete(id);
  // Drops the source files too: done with them, and they can be large.
  update(id, { ...patch, first: null, second: null });
  startWaiting();
}

// A finished WAV stays usable if only its MP3 failed.
function fail(id, error) {
  const wavReady = jobs.find((job) => job.id === id)?.wavUrl;
  finish(id, wavReady ? { status: 'done', mp3Failed: true } : { status: 'error', error });
}

function start(job) {
  const worker = new Worker(new URL('./mergeWorker.js', import.meta.url), { type: 'module' });
  workers.set(job.id, worker);
  update(job.id, { status: 'merging' });

  const setPercent = (field, value) => {
    const percent = Math.round(value * 100);
    if (jobs.find(({ id }) => id === job.id)?.[field] !== percent) update(job.id, { [field]: percent });
  };

  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') setPercent('progress', data.progress);
    else if (data.type === 'wav') update(job.id, { status: 'encoding', progress: 100, mp3Progress: 0, wavUrl: URL.createObjectURL(data.wav) });
    else if (data.type === 'mp3-progress') setPercent('mp3Progress', data.progress);
    else if (data.type === 'done') finish(job.id, { status: 'done', mp3: data.mp3, mp3Url: URL.createObjectURL(data.mp3) });
    else fail(job.id, data.message);
  };
  worker.onerror = () => fail(job.id, 'These audios could not be merged. Please try again.');
  worker.postMessage({ first: job.first, second: job.second });
}

function startWaiting() {
  const running = jobs.filter((job) => job.status === 'merging' || job.status === 'encoding').length;
  jobs.filter((job) => job.status === 'waiting').slice(0, MAX_RUNNING - running).forEach(start);
}

export function addMerge(first, second) {
  const id = nextId++;
  publish([{ id, name: outputName(first), first, second, status: 'waiting', progress: 0 }, ...jobs]);
  startWaiting();
  return id;
}

// Cancels a merge that is still going, or clears a finished one.
export function removeMerge(id) {
  const job = jobs.find((item) => item.id === id);
  workers.get(id)?.terminate();
  workers.delete(id);
  if (job?.mp3Url) URL.revokeObjectURL(job.mp3Url);
  if (job?.wavUrl) URL.revokeObjectURL(job.wavUrl);
  publish(jobs.filter((item) => item.id !== id));
  startWaiting();
}

export function subscribeToMerges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getMerges = () => jobs;

window.addEventListener('beforeunload', (event) => {
  if (jobs.some((job) => job.status !== 'done' && job.status !== 'error')) event.preventDefault();
});
