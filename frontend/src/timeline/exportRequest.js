// Posting a set of clips to the renderer, shared by the Editor tab's own
// Export button and by LongMix Studio's "Create the video" (which renders
// server-side without the user ever having to touch the timeline). Both go
// through the identical payload and the identical route, so a long mix is
// rendered by exactly the same pipeline - and with exactly the same
// preview-matches-export guarantee - as anything assembled by hand.
import API_BASE_URL from '../config';

// Turns clips into the multipart payload backend/routes/exportTimeline.js
// expects: the timeline as JSON, plus one file part per unique source. A
// clip already hosted by the backend (e.g. a Montage output pulled into the
// editor) is referenced by name instead of re-uploaded.
export function buildExportFormData(clips, canvasSize, projectName) {
  const formData = new FormData();
  const seenSources = new Set();
  let missingSourceClipId = null;

  const timelinePayload = clips.map((clip) => {
    const clipFields = {
      id: clip.id,
      type: clip.type || 'video',
      trackIndex: clip.trackIndex || 0,
      startTime: clip.startTime,
      trimmedStart: clip.trimmedStart,
      trimmedEnd: clip.trimmedEnd,
    };

    if (clip.type === 'text') {
      return { ...clipFields, text: clip.text };
    }

    // Adjustment layers (M13) carry no source media at all - only their
    // filters (color/vignette) matter, same shortcut text clips take.
    if (clip.type === 'adjustment') {
      return { ...clipFields, filters: clip.filters };
    }

    Object.assign(clipFields, {
      sourceId: clip.sourceId,
      transform: clip.transform,
      keyframes: clip.keyframes,
      filters: clip.filters,
      speed: clip.speed,
      volume: clip.volume,
      muted: clip.muted,
      audioFade: clip.audioFade,
      transitionOut: clip.transitionOut,
    });

    const isRemote = !(clip.file instanceof File) && typeof clip.url === 'string' && clip.url.includes('/clips/');
    if (isRemote) {
      return { ...clipFields, sourceKind: 'remote', remoteFileName: clip.url.split('/clips/').pop() };
    }

    if (clip.file instanceof File) {
      if (!seenSources.has(clip.sourceId)) {
        seenSources.add(clip.sourceId);
        formData.append(`source_${clip.sourceId}`, clip.file);
      }
    } else {
      missingSourceClipId = clip.id;
    }

    return { ...clipFields, sourceKind: 'upload' };
  });

  formData.append('timeline', JSON.stringify(timelinePayload));
  formData.append('projectName', projectName || 'nexeditor-export');
  // Sent as preset ids (aspectRatioId/resolutionId), not raw pixel
  // width/height - the backend re-derives real dimensions from its own
  // allow-list (see exportTimeline.js's resolveCanvas), so there's no
  // arbitrary client-supplied size to validate.
  formData.append('canvasSize', JSON.stringify({
    aspectRatioId: canvasSize?.aspectRatioId,
    resolutionId: canvasSize?.resolutionId,
    fps: canvasSize?.fps,
    fitMode: canvasSize?.fitMode,
  }));

  return { formData, missingSourceClipId };
}

// Polls the export job's own progress endpoint until it reaches a terminal
// state (a result or an error), resolving/rejecting accordingly. This is
// what actually watches a render through to completion - the POST below
// only gets it started (see exportTimeline.js's early 202: the connection
// that request opened is not what the render's result travels back on).
// Also used directly to re-attach to a job that was already running before
// a page reload (see hooks/usePersistedLongMixState.js), which is why it
// takes a bare `jobId` instead of assuming a fresh XHR just sent one.
export function pollExportProgress({ jobId, onProgress, isStillCurrent = () => true }) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/editor/export/progress/${jobId}`, { cache: 'no-store' });
        if (!response.ok || !isStillCurrent()) return;
        const status = await response.json();
        if (status.error) {
          clearInterval(timer);
          const error = new Error(status.error);
          error.code = status.code;
          reject(error);
          return;
        }
        if (status.result) {
          clearInterval(timer);
          resolve(status.result);
          return;
        }
        if (status.percent > 0) onProgress?.(status);
      } catch { /* transient - keep polling, the socket push (if any) still covers this tick */ }
    }, 750);
  });
}

// Uploads the timeline and hands back { jobId, promise }: `jobId` is
// available immediately (it's minted here, before the request even goes
// out) so a caller can persist it right away and resume watching the same
// job after a reload; `promise` resolves with the finished export result
// once the render completes, however long that takes. The socket push
// (export-progress, while this tab's connection is alive) and
// pollExportProgress's own fallback polling both feed `onProgress` - the
// job survives on the server either way (see exportTimeline.js).
export function postExportRequest({ formData, socketId, onProgress, isStillCurrent = () => true }) {
  const jobId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const accepted = new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_BASE_URL}/api/editor/export`);
    request.responseType = 'json';
    request.withCredentials = true;
    if (socketId) request.setRequestHeader('X-Socket-Id', socketId);
    request.setRequestHeader('X-Job-Id', jobId);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !isStillCurrent()) return;
      // The upload is only the first slice of the job's progress bar - the
      // render itself is the rest, and it's much the longer half.
      const percent = Math.max(1, Math.min(5, (event.loaded / event.total) * 5));
      onProgress?.({ percent, currentTime: `Uploading ${Math.round((event.loaded / event.total) * 100)}%...` });
    };

    request.onerror = () => reject(new Error('Unable to reach the export server.'));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      const error = new Error(request.response?.error || `Export failed (${request.status})`);
      error.code = request.response?.code;
      reject(error);
    };
    request.send(formData);
  });

  return { jobId, promise: accepted.then(() => pollExportProgress({ jobId, onProgress, isStillCurrent })) };
}

function exportDownloadUrl(data) {
  return `${API_BASE_URL}/api/editor/export/download/${encodeURIComponent(data.fileName)}?name=${encodeURIComponent(data.downloadName || data.fileName)}`;
}

// Whether a finished export is still on the server: 'available', 'expired'
// (the server itself said the file is gone - renders are only kept for a
// limited time, see server.js), or 'unreachable' (anything else: the server
// is down, or it's an older build without the download route). Only a real
// 'expired' may be treated as the file being gone - a network blip or a
// stale backend must never make a good result look deleted. The server's own
// "gone" answer is a JSON 404; an unknown route's 404 is HTML.
export async function exportResultStatus(data) {
  if (!data?.fileName) return 'expired';
  try {
    const response = await fetch(exportDownloadUrl(data), { method: 'HEAD' });
    if (response.ok) return 'available';
    const isServerAnswer = (response.headers.get('content-type') || '').includes('application/json');
    return response.status === 404 && isServerAnswer ? 'expired' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

// Downloads through the server's attachment endpoint rather than a link to
// /clips/<file>: a cross-origin `download` attribute is ignored by browsers
// (the dev frontend and backend are different origins), which left the click
// navigating to the video instead of saving it - and it streams straight to
// disk instead of buffering a multi-gigabyte mix in memory. Checked first so
// a missing file is a clear message, not an error page replacing the app.
export async function downloadExportResult(data) {
  const status = await exportResultStatus(data);
  if (status === 'expired') {
    const error = new Error('This video is no longer on the server (finished renders are kept for a limited time) - render it again.');
    error.expired = true;
    throw error;
  }
  if (status === 'unreachable') {
    throw new Error('Could not reach the download service. Make sure the backend is running the latest version (restart it), then try again - your video is still saved.');
  }
  const link = document.createElement('a');
  link.href = exportDownloadUrl(data);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function exportResultUrl(data) {
  return data?.filePath ? `${API_BASE_URL}${data.filePath}` : '';
}
