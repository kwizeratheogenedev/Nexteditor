import API_BASE_URL from '../config';
import { buildExportFormData } from './exportRequest';

// Sends the timeline's sounding clips (and their files) to the backend's
// /api/editor/captions and resolves with { words, language, duration }.
// Progress is polled from the job's own endpoint while the request runs.
export async function requestTimelineCaptions({ clips, canvasSize, language = 'auto', socketId, onProgress }) {
  const sounding = clips.filter((clip) => clip.type === 'audio' || clip.type === 'video');
  if (!sounding.length) throw new Error('Add a video or audio clip with sound first.');
  const { formData, missingSourceClipId } = buildExportFormData(sounding, canvasSize, 'captions');
  if (missingSourceClipId) throw new Error('One of your clips is missing its media file - re-import it and try again.');
  formData.append('language', language);

  const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const poll = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/editor/captions/progress/${jobId}`, { cache: 'no-store', credentials: 'include' });
      if (res.ok) onProgress?.(await res.json());
    } catch { /* keep polling */ }
  }, 800);

  try {
    const res = await fetch(`${API_BASE_URL}/api/editor/captions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Job-Id': jobId, ...(socketId ? { 'X-Socket-Id': socketId } : {}) },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Captions failed (${res.status}).`);
    return data;
  } finally {
    clearInterval(poll);
  }
}
