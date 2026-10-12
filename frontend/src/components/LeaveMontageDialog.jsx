import { useEffect, useRef } from 'react';

// Asked when the user tries to leave the Montage tab (or the editor page)
// while a montage is being made on their device (Server 2) - leaving stops
// it, and it has to be started again. "Stay" is the default.
export default function LeaveMontageDialog({ onStay, onLeave }) {
  const stayRef = useRef(null);
  useEffect(() => {
    stayRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onStay(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStay]);

  return (
    <div className="st-dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onStay(); }}>
      <div className="st-dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-montage-title" aria-describedby="leave-montage-text">
        <h2 id="leave-montage-title">Your montage isn't finished yet</h2>
        <p id="leave-montage-text" className="st-dialog-text">
          It's being made on this device (Server 2). If you leave now, it will stop and you'll have to start it again.
        </p>
        <div className="st-dialog-actions">
          <button type="button" className="st-dialog-secondary" onClick={onLeave}>Leave and stop it</button>
          <button type="button" className="st-dialog-primary" ref={stayRef} onClick={onStay}>Stay and wait</button>
        </div>
      </div>
    </div>
  );
}
