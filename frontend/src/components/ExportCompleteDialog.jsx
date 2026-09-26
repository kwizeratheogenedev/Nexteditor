import { useEffect, useRef } from 'react';

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${Math.round(n / 1048576)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

const CHECK = 'M5 12.5 10 17.5 19 7';
const CLOUD = 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9z';
const DOWN = 'M12 4v11 M7 10l5 5 5-5 M5 20h14';

// Shown over a blurred editor once an export has finished and downloaded.
// Only states facts: the file name/resolution/size of the render, that it
// was downloaded, and whether the project itself is saved to the account.
export default function ExportCompleteDialog({ result, onClose, onDownloadAgain }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = [result.fileName, result.resolution, result.size ? formatSize(result.size) : null].filter(Boolean).join(' · ');

  return (
    <div className="st-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-dialog" role="dialog" aria-modal="true" aria-labelledby="export-done-title">
        <div className="st-dialog-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={CHECK} /></svg>
        </div>
        <h2 id="export-done-title">Export complete</h2>
        {meta && <p className="st-dialog-meta">{meta}</p>}
        <div className="st-dialog-chips">
          <span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={DOWN} /></svg>
            Downloaded to your device
          </span>
          {result.savedToAccount ? (
            <span>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true"><path d={CLOUD} /></svg>
              Saved to your projects
            </span>
          ) : (
            <span className="is-muted">Project saved in this browser</span>
          )}
        </div>
        <div className="st-dialog-actions">
          {onDownloadAgain && <button type="button" className="st-dialog-secondary" onClick={onDownloadAgain}>Download again</button>}
          <button type="button" className="st-dialog-primary" ref={closeRef} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
