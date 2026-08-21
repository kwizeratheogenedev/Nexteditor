import { useEffect, useState } from 'react';
import API_BASE_URL, { API_ENDPOINTS } from '../config.js';

const KIND_LABEL = {
  montage: 'Montage',
  export: 'Export',
  captions: 'Captions',
  shorts: 'Shorts',
  'youtube-upload': 'YouTube upload',
};

// Surfaces any jobs that were still running or just finished while the user
// was logged out (or mid-page-reload) - the actual processing already
// continued server-side regardless of the browser being open; this just
// makes the result visible again instead of it silently vanishing.
export default function JobsResumeBanner() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch(API_ENDPOINTS.jobsMine, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((data) => {
        if (!cancelled) setJobs(data.jobs || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (jobId) => {
    setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    fetch(API_ENDPOINTS.jobAck(jobId), { method: 'POST', credentials: 'include' }).catch(() => {});
  };

  if (jobs.length === 0) return null;

  return (
    <div style={{ position: 'fixed', top: 56, right: 16, zIndex: 900, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
      {jobs.map((job) => (
        <div
          key={job.jobId}
          style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            padding: 12, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <strong>{KIND_LABEL[job.kind] || job.kind}</strong>
            <button type="button" onClick={() => dismiss(job.jobId)} style={{ background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}>&times;</button>
          </div>
          {job.status === 'running' && (
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Still processing ({Math.round(job.progress || 0)}%) - this continued while you were away.</div>
          )}
          {job.status === 'done' && (
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
              Finished while you were away.
              {job.result?.fileName && (
                <>
                  {' '}
                  <a
                    href={`${API_BASE_URL}/clips/${encodeURIComponent(job.result.fileName)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    Download
                  </a>
                </>
              )}
            </div>
          )}
          {job.status === 'error' && (
            <div style={{ color: '#ff8a8a', marginTop: 4 }}>Failed: {job.error || 'Unknown error'}</div>
          )}
        </div>
      ))}
    </div>
  );
}
