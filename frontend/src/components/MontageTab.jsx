import { useEffect, useRef, useState, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { usePersistedMontageState } from '../hooks/usePersistedMontageState';
import API_BASE, { API_ENDPOINTS } from '../config';

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const t = Math.floor(Number(seconds) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function createVideoSlot(id) {
  return { id, sourceMode: 'device', file: null, url: '', filePath: '', fileName: '', duration: null, status: 'idle', progress: 0, error: '' };
}

function createAudioSlot() {
  return { sourceMode: 'device', file: null, url: '', filePath: '', fileName: '', duration: null, status: 'idle', progress: 0, error: '' };
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icon = {
  Film: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m15 12-5-3v6l5-3z"/><path d="M2 8h2M2 12h2M2 16h2M20 8h2M20 12h2M20 16h2"/>
    </svg>
  ),
  Music: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-3v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  ),
  Upload: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  Link: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Spin: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{animation:'spin .8s linear infinite'}}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  ),
  Play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21"/>
    </svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
    </svg>
  ),
  Download: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Edit: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  Star: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17.75 7.5 20l1-5.5L4 10.75l5.6-.8L12 5l2.4 4.95 5.6.8-4.5 3.75 1 5.5z" />
    </svg>
  ),
  Maximize: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>
  ),
  Minimize: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
    </svg>
  ),
  VolumeUp: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  ),
  VolumeMute: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
    </svg>
  ),
  SkipForward: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
    </svg>
  ),
  SkipBack: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="19 4 9 12 19 20 19 4"/><line x1="5" y1="5" x2="5" y2="19"/>
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Youtube: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z"/>
    </svg>
  ),
  Waveform: () => (
    <svg viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="12" x2="2" y2="12"/><line x1="6" y1="8" x2="6" y2="16"/>
      <line x1="10" y1="4" x2="10" y2="20"/><line x1="14" y1="7" x2="14" y2="17"/>
      <line x1="18" y1="10" x2="18" y2="14"/><line x1="22" y1="5" x2="22" y2="19"/>
      <line x1="26" y1="8" x2="26" y2="16"/><line x1="30" y1="6" x2="30" y2="18"/>
      <line x1="34" y1="9" x2="34" y2="15"/><line x1="38" y1="11" x2="38" y2="13"/>
    </svg>
  ),
};

// ─── Styles (injected once) ───────────────────────────────────────────────────

const STYLES = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse-ring { 0%,100% { opacity:.15; } 50% { opacity:.35; } }
  @keyframes bar-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
  @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }

  .mt-fade-up { animation: fadeUp .4s cubic-bezier(.16,1,.3,1) both; }
  .mt-card { transition: border-color .2s, box-shadow .2s; }
  .mt-card:hover { border-color: var(--panel-surface-5) !important; }
  .mt-card.is-ready { border-color: rgba(124,58,237,.4) !important; box-shadow: 0 0 0 1px rgba(124,58,237,.08), inset 0 1px 0 rgba(255,255,255,.03); }
  .mt-card.is-audio.is-ready { border-color: rgba(236,72,153,.4) !important; box-shadow: 0 0 0 1px rgba(236,72,153,.08), inset 0 1px 0 rgba(255,255,255,.03); }
  .mt-card.is-error { border-color: rgba(239,68,68,.35) !important; }

  .mt-thumb { position:relative; overflow:hidden; transition: all .2s; }
  .mt-thumb:hover .mt-thumb-overlay { opacity:1; }
  .mt-thumb-overlay { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .2s; }

  .mt-pill-track { background:var(--panel-surface-1); border:1px solid var(--panel-surface-2); border-radius:10px; padding:3px; display:flex; }
  .mt-pill-opt { flex:1; font-size:12px; font-weight:500; padding:8px 0; border-radius:9px; text-align:center; transition:all .2s; cursor:pointer; color:var(--panel-text-2); border:none; background:transparent; display:flex; align-items:center; justify-content:center; gap:6px; }
  .mt-pill-opt.active { background:var(--accent-violet); color:#fff; box-shadow:0 4px 16px rgba(124,58,237,.22); }
  .mt-pill-opt.active-audio { background:var(--accent-pink); color:#fff; box-shadow:0 4px 16px rgba(219,39,119,.22); }
  .mt-pill-opt:not(.active):not(.active-audio):hover { color:var(--accent-violet-light); }

  .mt-config-group { display:flex; flex-direction:column; gap:8px; }
  .mt-config-label { font-size:12px; font-weight:700; color:var(--panel-text-2); text-transform:uppercase; letter-spacing:.14em; }
  .mt-config-select { background:var(--panel-surface-0); border:1px solid var(--panel-surface-2); border-radius:12px; color:var(--text-primary); font-size:12px; padding:10px 12px; outline:none; }
  .mt-config-select:focus { border-color:var(--accent-violet); }
  .mt-config-toggle { width:100%; border:1px solid var(--panel-surface-2); border-radius:14px; background:transparent; color:var(--accent-purple-light); padding:12px 0; font-size:12px; font-weight:600; cursor:pointer; transition:all .2s; }
  .mt-config-toggle.active { background:var(--panel-surface-3); border-color:var(--accent-violet); color:var(--panel-text-1); }

  .mt-video-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; align-items:stretch; }
  .mt-side { width:340px; min-width:300px; flex-shrink:0; }
  @media (max-width:1180px) { .mt-video-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media (max-width:1000px) {
    .mt-body { flex-direction:column; overflow-y:auto !important; }
    .mt-main { overflow:visible !important; flex:none !important; }
    .mt-side { width:100%; min-width:0; overflow:visible !important; padding:0 20px 20px !important; }
  }
  @media (max-width:560px) { .mt-video-grid { grid-template-columns:minmax(0,1fr); } }

  .mt-add-card { min-height:220px; }
  .mt-add-card:hover { border-color: rgba(124,58,237,.5); background: rgba(124,58,237,.04); }

  .mt-card { transition: border-color .2s, box-shadow .2s; }
  .mt-card:hover { border-color: var(--panel-surface-5) !important; }
  .mt-url-input::placeholder { color:var(--panel-text-3); }
  .mt-url-input:focus { border-color:rgba(124,58,237,.5); }

  .mt-merge-btn { position:relative; overflow:hidden; }
  .mt-merge-btn::before { content:''; position:absolute; inset:0; background:linear-gradient(135deg,rgba(255,255,255,.08) 0%,transparent 50%); pointer-events:none; }
  .mt-merge-btn:hover:not(:disabled)::after { content:''; position:absolute; inset:0; background:rgba(255,255,255,.06); }

  .mt-progress-bar { background: linear-gradient(90deg, var(--accent-violet), var(--accent-violet-light), var(--accent-violet)); background-size:200% 100%; animation: bar-shimmer 2s linear infinite; }

  .mt-video-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.4); opacity:0; transition:opacity .2s; }
  .mt-video-container:hover .mt-video-overlay { opacity:1; }

  .mt-float { animation: float 3s ease-in-out infinite; }
  .mt-stagger-1 { animation-delay:.05s; }
  .mt-stagger-2 { animation-delay:.1s; }
  .mt-stagger-3 { animation-delay:.15s; }
  .mt-stagger-4 { animation-delay:.2s; }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  const el = document.createElement('style');
  el.textContent = STYLES;
  document.head.appendChild(el);
  stylesInjected = true;
}

// ─── MediaCard ────────────────────────────────────────────────────────────────

function MediaCard({ label, item, setItem, accept, type, onError, isOptional = false, isAudio = false, animDelay = '' }) {
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const { socket, socketId } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const progressEvent = isAudio ? 'audio-fetch-progress' : 'url-fetch-progress';
    const errorEvent   = isAudio ? 'audio-fetch-error'    : 'url-fetch-error';
    const onProgress = (p) => setItem(prev => prev.status === 'loading' ? { ...prev, progress: p?.percent || 0 } : prev);
    const onErr      = (p) => setItem(prev => prev.status === 'loading' ? { ...prev, status:'error', progress:0, error: p?.error || `Failed to fetch ${type}` } : prev);
    socket.on(progressEvent, onProgress);
    socket.on(errorEvent, onErr);
    return () => { socket.off(progressEvent, onProgress); socket.off(errorEvent, onErr); };
  }, [isAudio, setItem, type, socket]);

  useEffect(() => {
    if (item.status === 'ready' && item.file && !isAudio && videoRef.current) {
      const v = videoRef.current;
      const src = URL.createObjectURL(item.file);
      v.src = src;
      v.play().catch(() => {});
      return () => { v.pause(); URL.revokeObjectURL(src); };
    }
  }, [item.status, item.file, isAudio]);

  const handleMode = (mode) => {
    if (isAudio) return;
    setItem(prev => ({ ...prev, sourceMode: mode, error: '' }));
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const valid = isAudio ? file.type.startsWith('audio/') : file.type.startsWith('video/');
    if (!valid) { setItem(prev => ({ ...prev, status:'error', error:`Invalid ${type} file`, progress:0 })); e.target.value = ''; return; }
    const el = document.createElement(isAudio ? 'audio' : 'video');
    el.src = URL.createObjectURL(file);
    el.onloadedmetadata = () => {
      setItem(prev => ({ ...prev, file, filePath:'', fileName:file.name, duration:el.duration, status:'ready', progress:100, error:'' }));
      URL.revokeObjectURL(el.src);
    };
    el.onerror = () => { setItem(prev => ({ ...prev, status:'error', error:`Failed to load ${type}`, progress:0 })); };
  };

  const handleUrl = async () => {
    const url = item.url?.trim();
    if (!url) return;
    setItem(prev => ({ ...prev, status:'loading', progress:0, error:'' }));
    try {
      const res = await fetch(API_ENDPOINTS.fetchUrlVideo, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url, type: isAudio ? 'audio' : 'video', socketId }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to fetch URL'); }
      const d = await res.json();
      setItem(prev => ({ ...prev, filePath:d.filePath, fileName:d.fileName, duration:d.duration, status:'ready', progress:100, error:'' }));
    } catch (err) {
      const msg = err.message || 'Failed to fetch URL';
      setItem(prev => ({ ...prev, status:'error', error:msg, progress:0 }));
      onError?.(msg);
    }
  };

  const handleClear = () => setItem(isAudio ? createAudioSlot() : createVideoSlot(item.id));

  const isLoading = item.status === 'loading';
  const isReady   = item.status === 'ready';
  const isError   = item.status === 'error';

  const accent    = isAudio ? 'audio' : 'video';
  const accentClr = isAudio ? 'var(--accent-pink)' : 'var(--accent-violet)';

    return (
    <div
      className={`mt-card mt-fade-up ${animDelay} ${isReady ? (isAudio ? 'is-ready is-audio' : 'is-ready') : ''} ${isError ? 'is-error' : ''}`}
      style={{
        background: isAudio && isReady ? 'var(--panel-surface-1)' : 'var(--panel-surface-0)',
        border: isAudio && isReady ? '1px solid rgba(219,39,119,.65)' : '1px solid var(--panel-surface-2)',
        borderRadius:16,
        overflow:'hidden',
        display:'flex',
        flexDirection:'column',
        flex: isAudio ? '0 0 auto' : '1 1 auto',
        minHeight: isAudio ? 280 : undefined,
        maxHeight: isAudio ? 460 : 'unset',
        boxShadow: isAudio && isReady ? '0 20px 70px rgba(219,39,119,.08)' : undefined,
      }}
    >
      {/* ── Header */}
      <div style={{ padding:'14px 16px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--panel-surface-1)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background: isAudio ? 'rgba(219,39,119,.12)' : 'rgba(124,58,237,.12)', display:'flex', alignItems:'center', justifyContent:'center', color:accentClr }}>
            <div style={{ width:16, height:16 }}>{isAudio ? <Icon.Music /> : <Icon.Film />}</div>
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)', letterSpacing:'-0.01em' }}>{label}</div>
            {isOptional && <div style={{ fontSize:12, color:'var(--panel-border-strong)', marginTop:1 }}>optional</div>}
          </div>
        </div>
        {!isReady && !isLoading && item.sourceMode === 'device' && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width:28,
              height:28,
              borderRadius:8,
              background:'var(--info-dark)',
              border:'1px solid var(--info)',
              color:'var(--panel-text-1)',
              cursor:'pointer',
              display:'flex',
              alignItems:'center',
              justifyContent:'center',
              boxShadow:'0 4px 12px rgba(30,58,138,.28)',
            }}
          >
            <div style={{ width:14, height:14 }}><Icon.Plus /></div>
          </button>
        )}
        {isReady && (
          <button onClick={handleClear} style={{ width:26, height:26, borderRadius:7, background:'var(--panel-surface-1)', border:'1px solid var(--panel-surface-3)', color:'var(--text-muted)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(239,68,68,.15)'; e.currentTarget.style.color='var(--danger)'; e.currentTarget.style.borderColor='rgba(239,68,68,.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='var(--panel-surface-1)'; e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.borderColor='var(--panel-surface-3)'; }}
          >
            <div style={{ width:12, height:12 }}><Icon.X /></div>
          </button>
        )}
      </div>

      {/* ── Thumbnail */}
      <div
        className="mt-thumb"
        onClick={() => !isLoading && item.sourceMode === 'device' && fileInputRef.current?.click()}
        style={{ margin:'18px 14px 0', borderRadius:10, background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-1)', aspectRatio: isAudio ? '3 / 1' : '16/9', minHeight: isAudio ? 220 : undefined, maxHeight: isAudio ? 320 : undefined, cursor: (!isLoading && item.sourceMode === 'device') ? 'pointer' : 'default', position:'relative', overflow:'hidden' }}
      >
        {/* empty state */}
        {!isLoading && !isReady && (
          <>
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
              <div style={{ width:40, height:40, borderRadius:10, border:`1px dashed ${accentClr}33`, display:'flex', alignItems:'center', justifyContent:'center', color:`${accentClr}55` }}>
                <div style={{ width:20, height:20 }}>{isAudio ? <Icon.Music /> : <Icon.Plus />}</div>
              </div>
              <span style={{ fontSize:12, color:'var(--panel-text-3)' }}>
                {item.sourceMode === 'device' ? `Click to add ${type}` : 'Enter URL below'}
              </span>
              {item.sourceMode === 'device' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{
                    marginTop:4,
                    minHeight:34,
                    padding:'0 14px',
                    borderRadius:999,
                    border:`1px solid ${accentClr}55`,
                    background:isAudio ? 'rgba(219,39,119,.22)' : 'rgba(124,58,237,.22)',
                    color:'var(--panel-text-1)',
                    fontSize:12,
                    fontWeight:700,
                    display:'inline-flex',
                    alignItems:'center',
                    justifyContent:'center',
                    gap:6,
                    cursor:'pointer',
                    zIndex:2,
                  }}
                >
                  <div style={{ width:12, height:12 }}><Icon.Upload /></div>
                  {isAudio ? 'Choose Audio' : 'Choose Video'}
                </button>
              )}
            </div>
            {/* subtle grid bg */}
            <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px)', backgroundSize:'24px 24px', pointerEvents:'none' }} />
          </>
        )}

        {/* loading */}
        {isLoading && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, background:'rgba(8,8,16,.9)' }}>
            <div style={{ width:36, height:36, borderRadius:10, background:`${accentClr}20`, display:'flex', alignItems:'center', justifyContent:'center', color:accentClr }}>
              <div style={{ width:18, height:18 }}><Icon.Spin /></div>
            </div>
            <div style={{ width:100, height:2, background:'var(--panel-surface-2)', borderRadius:99, overflow:'hidden' }}>
              <div className="mt-progress-bar" style={{ width:`${item.progress}%`, height:'100%', borderRadius:99, transition:'width .3s' }} />
            </div>
            <span style={{ fontSize:12, color:'var(--text-muted)' }}>{Math.round(item.progress)}%</span>
          </div>
        )}

        {/* video preview */}
        {isReady && !isAudio && <video ref={videoRef} muted autoPlay loop style={{ width:'100%', height:'100%', objectFit:'cover' }} />}

        {/* audio ready */}
        {isReady && isAudio && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', padding:'10px 12px', background:'rgba(15,10,26,.95)', color:'var(--accent-pink-light)', fontSize:12, fontWeight:600, textAlign:'center', lineHeight:1.4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center' }}><Icon.Music /></div>
              <span>{item.fileName || 'Audio ready'}</span>
            </div>
          </div>
        )}

        {/* hover overlay (device+ready only) */}
        {isReady && !isAudio && (
          <div className="mt-thumb-overlay">
            <div style={{ width:32, height:32, borderRadius:8, background:'rgba(124,58,237,.8)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff' }}>
              <div style={{ width:14, height:14 }}><Icon.Edit /></div>
            </div>
          </div>
        )}
      </div>

      {isAudio && (
        <div style={{ padding:'16px 16px 0', display:'flex', alignItems:'center', justifyContent:'space-between', gap:14, minHeight:52, borderBottom:'1px solid rgba(255,255,255,.04)' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--panel-text-1)', letterSpacing:'-0.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {item.fileName || 'No audio selected'}
            </div>
            <div style={{ fontSize:12, color:'var(--panel-text-2)', marginTop:4 }}>
              {item.status === 'ready' ? `${formatDuration(item.duration)} · ${formatFileSize(item.file?.size)}` : 'Upload a song to power your montage'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              minWidth:110,
              padding:'10px 14px',
              borderRadius:12,
              border:'1px solid rgba(219,39,119,.35)',
              background:'rgba(219,39,119,.1)',
              color:'var(--accent-pink-light)',
              fontSize:12,
              fontWeight:700,
              cursor:'pointer',
              display:'inline-flex',
              alignItems:'center',
              justifyContent:'center',
              gap:8,
            }}
          >
            <div style={{ width:16, height:16, display:'flex', alignItems:'center', justifyContent:'center' }}><Icon.Upload /></div>
            {item.status === 'ready' ? 'Change audio' : 'Add audio'}
          </button>
        </div>
      )}

      {/* ── Controls */}
      <div style={{ padding:'12px 14px 14px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>

        {!isLoading && !isReady && (
          <>
            {/* pill toggle */}
            <div className="mt-pill-track">
              <button className={`mt-pill-opt ${item.sourceMode === 'device' ? (isAudio ? 'active-audio' : 'active') : ''}`} onClick={() => handleMode('device')}>
                <div style={{ width:12, height:12 }}><Icon.Upload /></div> Device
              </button>
              {!isAudio && (
                <button className={`mt-pill-opt ${item.sourceMode === 'url' ? 'active' : ''}`} onClick={() => handleMode('url')}>
                  <div style={{ width:12, height:12 }}><Icon.Link /></div> URL
                </button>
              )}
            </div>

            {item.sourceMode === 'device' && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width:'100%',
                  minHeight:40,
                  borderRadius:10,
                  border:`1px solid ${accentClr}44`,
                  background:isAudio ? 'rgba(219,39,119,.12)' : 'rgba(124,58,237,.12)',
                  color:isAudio ? 'var(--accent-pink-light)' : 'var(--accent-violet-light)',
                  fontSize:12,
                  fontWeight:600,
                  display:'flex',
                  alignItems:'center',
                  justifyContent:'center',
                  gap:8,
                  cursor:'pointer',
                }}
              >
                <div style={{ width:14, height:14 }}><Icon.Upload /></div>
                {isAudio ? 'Upload Audio' : 'Upload Video'}
              </button>
            )}

            {!isAudio && item.sourceMode === 'url' && (
              <div style={{ display:'flex', gap:6 }}>
                <input
                  className="mt-url-input"
                  placeholder="YouTube, Drive, Dropbox, or direct URL..."
                  value={item.url || ''}
                  onChange={e => setItem(p => ({ ...p, url: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleUrl()}
                />
                <button
                  onClick={handleUrl}
                  style={{ background:accentClr, color:'#fff', border:'none', borderRadius:8, padding:'0 14px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', transition:'opacity .15s' }}
                  onMouseEnter={e => e.currentTarget.style.opacity='.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity='1'}
                >
                  Go
                </button>
              </div>
            )}
          </>
        )}

        {/* ready info */}
        {isReady && (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'var(--panel-surface-0)', borderRadius:9, border:`1px solid ${accentClr}22` }}>
            <div style={{ width:20, height:20, borderRadius:6, background:`${accentClr}20`, display:'flex', alignItems:'center', justifyContent:'center', color:accentClr, flexShrink:0 }}>
              <div style={{ width:11, height:11 }}><Icon.Check /></div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, color:'var(--panel-text-2)', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.fileName}</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>{formatDuration(item.duration)}</div>
            </div>
          </div>
        )}

        {/* error */}
        {isError && !isLoading && (
          <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', background:'rgba(239,68,68,.06)', borderRadius:9, border:'1px solid rgba(239,68,68,.2)' }}>
            <span style={{ fontSize:12, color:'var(--danger)', lineHeight:1.4 }}>{item.error}</span>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept={accept} style={{ display:'none' }} onChange={handleFile} />
    </div>
  );
}

function AudioCard({ item, setItem, accept, onError }) {
  const fileInputRef = useRef(null);
  const isReady = item.status === 'ready';
  const isLoading = item.status === 'loading';
  const isError = item.status === 'error';

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setItem(prev => ({ ...prev, status:'error', error:'Invalid audio file', progress:0 }));
      e.target.value = '';
      return;
    }
    const audioEl = document.createElement('audio');
    audioEl.src = URL.createObjectURL(file);
    audioEl.onloadedmetadata = () => {
      setItem(prev => ({ ...prev, file, filePath:'', fileName:file.name, duration:audioEl.duration, status:'ready', progress:100, error:'' }));
      URL.revokeObjectURL(audioEl.src);
    };
    audioEl.onerror = () => { setItem(prev => ({ ...prev, status:'error', error:'Failed to load audio', progress:0 })); };
  };

  const handleClear = () => setItem(createAudioSlot());
  const handleUpload = () => fileInputRef.current?.click();

  return (
    <div style={{ position:'relative', borderRadius:22, background:'var(--panel-surface-0)', border:'1px solid rgba(124,58,237,.22)', padding:22, boxShadow:'0 28px 80px rgba(0,0,0,.18)', display:'flex', flexDirection:'column', gap:18 }}>
      <button
        type="button"
        onClick={isReady ? handleClear : handleUpload}
        style={{ position:'absolute', top:14, right:14, width:42, height:42, display:'flex', alignItems:'center', justifyContent:'center', border:'none', background:'transparent', padding:0, cursor:'pointer', zIndex:5 }}
        aria-label={isReady ? 'Remove audio track' : 'Add audio track'}
      >
        {!isReady && <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(124,58,237,.18)', animation:'pulse-add 1.6s ease-out infinite' }} />}
        <div style={{ position:'relative', width:34, height:34, borderRadius:12, background:'var(--accent-violet)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', boxShadow:'0 0 0 1px rgba(255,255,255,.06)' }}>
          {isReady ? <Icon.X /> : <Icon.Plus />}
        </div>
      </button>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:40, height:40, borderRadius:14, background:'rgba(124,58,237,.16)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent-violet-light)' }}><Icon.Music /></div>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--panel-text-1)' }}>Background Audio</div>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'16px', borderRadius:18, background:'var(--panel-surface-0)', border:'1px solid rgba(255,255,255,.04)' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--panel-text-1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{isReady ? item.fileName || 'Uploaded audio' : 'No audio selected'}</div>
            <div style={{ fontSize:12, color:'var(--panel-text-2)', marginTop:4 }}>
              {isReady ? `${formatDuration(item.duration)} · ${formatFileSize(item.file?.size)}` : 'Use the button below to add your song.'}
            </div>
          </div>
          {isReady && <div style={{ padding:'6px 10px', borderRadius:999, background:'rgba(124,58,237,.16)', color:'var(--accent-violet-light)', fontSize:12, fontWeight:700 }}>Replace track</div>}
        </div>

        {isError && (
          <div style={{ color:'var(--danger)', fontSize:12, background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.18)', borderRadius:12, padding:'10px 12px' }}>{item.error}</div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept={accept} style={{ display:'none' }} onChange={handleFile} />
    </div>
  );
}

// ─── Preview states ────────────────────────────────────────────────────────────

function IdlePreview({ readyCount }) {
  return (
    <div className="mt-fade-up" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16, textAlign:'center', maxWidth:340 }}>
      <div className="mt-float" style={{ width:72, height:72, borderRadius:20, background:'rgba(124,58,237,.1)', border:'1px solid rgba(124,58,237,.2)', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(124,58,237,.7)' }}>
        <div style={{ width:36, height:36 }}><Icon.Film /></div>
      </div>
      <div>
        <div style={{ fontSize:18, fontWeight:600, color:'var(--accent-purple-light)', letterSpacing:'-0.02em', marginBottom:6 }}>Montage Creator</div>
        <div style={{ fontSize:13, color:'var(--panel-border-strong)', lineHeight:1.6 }}>
          {readyCount === 0 && 'Add 3 videos and 1 audio track to begin'}
          {readyCount === 1 && 'Add 2 more videos and your audio track'}
          {readyCount === 2 && 'Add 1 more video and your audio track'}
          {readyCount >= 3 && 'All video slots are ready. Add audio, then merge.'}
        </div>
      </div>
      {readyCount >= 3 && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', background:'rgba(124,58,237,.1)', borderRadius:99, border:'1px solid rgba(124,58,237,.25)' }}>
          <div style={{ width:14, height:14, color:'var(--accent-purple)' }}><Icon.Check /></div>
          <span style={{ fontSize:12, color:'var(--accent-purple)', fontWeight:500 }}>Video slots ready</span>
        </div>
      )}
    </div>
  );
}

function ProcessingPreview({ progress, status, totalEstimatedTime, timeSpent, timeLeft }) {
  const fallbackStatus =
    progress < 15 ? 'Preparing montage...' :
    progress < 60 ? 'Creating random clips...' :
    progress < 95 ? 'Joining clips with audio...' : 'Finalizing output...';

  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;

  const formatTime = (seconds) => {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="mt-fade-up" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, textAlign:'center' }}>
      <div style={{ position:'relative', width:120, height:120 }}>
        {/* pulse ring */}
        <div style={{ position:'absolute', inset:-8, borderRadius:'50%', border:'1px solid rgba(124,58,237,.15)', animation:'pulse-ring 2s ease-in-out infinite' }} />
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform:'rotate(-90deg)' }}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--panel-surface-1)" strokeWidth="6"/>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--accent-violet)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset} style={{ transition:'stroke-dashoffset .5s cubic-bezier(.4,0,.2,1)' }} />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontSize:22, fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.03em' }}>{Math.round(progress)}<span style={{ fontSize:13, color:'var(--accent-violet)' }}>%</span></span>
        </div>
      </div>
      <div>
        <div style={{ fontSize:15, fontWeight:600, color:'var(--accent-purple-light)', marginBottom:6 }}>Creating Your Montage</div>
        <div style={{ fontSize:12, color:'var(--text-muted)' }}>{status || fallbackStatus}</div>
        {(totalEstimatedTime > 0 || timeSpent > 0 || timeLeft > 0) && (
          <div style={{ fontSize:12, color:'var(--panel-text-3)', marginTop:6, display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
            {totalEstimatedTime > 0 && <span>Total: {formatTime(totalEstimatedTime)}</span>}
            {timeSpent > 0 && <span>Spent: {formatTime(timeSpent)}</span>}
            {timeLeft > 0 && <span>Left: {formatTime(timeLeft)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── YouTube publish panel ─────────────────────────────────────────────────
// Uploads the finished montage straight to YouTube (no manual
// download-then-reupload), then lets the user finish title/description/
// tags/hashtags in-app once the upload lands - saved back via a second
// videos.update call rather than making them go to YouTube Studio.

const ytFieldLabel = { fontSize:12, fontWeight:600, color:'var(--panel-text-3)', textTransform:'uppercase', letterSpacing:'.03em' };
const ytFieldInput = { width:'100%', padding:'8px 10px', background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-3)', borderRadius:8, color:'var(--panel-text-1)', fontSize:12, outline:'none', boxSizing:'border-box' };
const ytPrimaryBtn = { display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 16px', background:'var(--danger)', border:'none', borderRadius:10, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer' };

function YouTubePublishPanel({ outputFile, onClose }) {
  const { socket, socketId } = useSocket();
  // checking -> not-configured | disconnected -> connecting -> ready -> uploading -> details -> saved
  const [status, setStatus] = useState('checking');
  const [channel, setChannel] = useState(null);
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [saving, setSaving] = useState(false);
  const [videoId, setVideoId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [form, setForm] = useState({
    title: (outputFile.downloadName || outputFile.fileName || '').replace(/\.[^.]+$/, ''),
    description: '',
    tags: '',
    hashtags: '',
    privacyStatus: 'private',
  });
  const pollRef = useRef(null);
  const pollAttemptsRef = useRef(0);

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(API_ENDPOINTS.youtubeAuthStatus, { credentials: 'include' });
      const data = await res.json();
      if (data.connected) {
        setChannel({ title: data.channelTitle, thumbnail: data.channelThumbnail });
        setStatus((prev) => (prev === 'uploading' || prev === 'details' || prev === 'saved' ? prev : 'ready'));
        return true;
      }
      setStatus(data.configured ? 'disconnected' : 'not-configured');
      return false;
    } catch {
      setStatus('not-configured');
      return false;
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handleProgress = (payload) => setProgress(payload?.percent || 0);
    socket.on('youtube-upload-progress', handleProgress);
    return () => socket.off('youtube-upload-progress', handleProgress);
  }, [socket]);

  const handleConnect = async () => {
    setErrorText('');
    try {
      const res = await fetch(API_ENDPOINTS.youtubeAuthUrl, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setErrorText(data.error || 'Could not start the connection.');
        return;
      }
      setStatus('connecting');
      const popup = window.open(data.url, 'youtube-oauth', 'width=520,height=680');
      pollAttemptsRef.current = 0;
      pollRef.current = setInterval(async () => {
        pollAttemptsRef.current += 1;
        const connected = await checkStatus();
        const timedOut = pollAttemptsRef.current > 80; // ~2 minutes at 1.5s
        if (connected || popup?.closed || timedOut) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (!connected) {
            setStatus('disconnected');
            if (timedOut) setErrorText('Connection timed out - try again.');
          }
        }
      }, 1500);
    } catch (err) {
      setErrorText(err.message || 'Could not start the connection.');
    }
  };

  const handleUpload = async () => {
    setErrorText('');
    setStatus('uploading');
    setProgress(0);
    try {
      const jobId = `yt-${Date.now()}`;
      const res = await fetch(API_ENDPOINTS.youtubeUpload, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Job-Id': jobId,
          ...(socketId ? { 'X-Socket-Id': socketId } : {}),
        },
        body: JSON.stringify({
          filePath: outputFile.filePath,
          fileName: outputFile.fileName,
          title: form.title,
          privacyStatus: form.privacyStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      setVideoId(data.videoId);
      setVideoUrl(data.videoUrl);
      setStatus('details');
    } catch (err) {
      setErrorText(err.message || 'Upload failed.');
      setStatus('ready');
    }
  };

  const handleSaveDetails = async () => {
    setErrorText('');
    setSaving(true);
    try {
      const res = await fetch(API_ENDPOINTS.youtubeVideo(videoId), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      setStatus('saved');
    } catch (err) {
      setErrorText(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', backdropFilter:'blur(2px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }} onClick={onClose}>
      <div className="mt-fade-up" style={{ width:420, maxWidth:'92vw', maxHeight:'86vh', overflowY:'auto', background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-3)', borderRadius:16, padding:20, display:'flex', flexDirection:'column', gap:12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:20, height:20, color:'var(--danger)' }}><Icon.Youtube /></div>
            <span style={{ fontSize:14, fontWeight:700, color:'var(--panel-text-1)' }}>Upload to YouTube</span>
          </div>
          <button onClick={onClose} style={{ width:26, height:26, borderRadius:8, background:'transparent', border:'none', color:'var(--panel-text-3)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ width:14, height:14 }}><Icon.X /></div>
          </button>
        </div>

        {errorText && (
          <div style={{ padding:'8px 10px', background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', borderRadius:8, color:'var(--danger)', fontSize:12 }}>{errorText}</div>
        )}

        {status === 'checking' && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'20px 0', color:'var(--panel-text-3)', fontSize:12 }}>
            <div style={{ width:14, height:14 }}><Icon.Spin /></div> Checking connection...
          </div>
        )}

        {status === 'not-configured' && (
          <div style={{ fontSize:12, color:'var(--panel-text-2)', lineHeight:1.6 }}>
            YouTube upload isn&apos;t set up yet. Add <code>YOUTUBE_CLIENT_ID</code>, <code>YOUTUBE_CLIENT_SECRET</code> and <code>YOUTUBE_REDIRECT_URI</code> to <code>backend/.env</code> and restart the server, then reopen this panel.
          </div>
        )}

        {(status === 'disconnected' || status === 'connecting') && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:'16px 0' }}>
            <div style={{ fontSize:12, color:'var(--panel-text-2)', textAlign:'center' }}>Connect your YouTube account to publish this video directly from NexEditor.</div>
            <button disabled={status === 'connecting'} onClick={handleConnect} style={{ ...ytPrimaryBtn, cursor: status === 'connecting' ? 'default' : 'pointer', opacity: status === 'connecting' ? 0.7 : 1 }}>
              {status === 'connecting' ? (
                <><div style={{ width:13, height:13 }}><Icon.Spin /></div> Waiting for Google...</>
              ) : (
                <><div style={{ width:13, height:13 }}><Icon.Youtube /></div> Connect YouTube account</>
              )}
            </button>
          </div>
        )}

        {status === 'ready' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {channel && (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-2)', borderRadius:10 }}>
                {channel.thumbnail && <img src={channel.thumbnail} alt="" style={{ width:24, height:24, borderRadius:'50%' }} />}
                <span style={{ fontSize:12, color:'var(--panel-text-2)' }}>Connected as <b style={{ color:'var(--panel-text-1)' }}>{channel.title}</b></span>
              </div>
            )}
            <label style={ytFieldLabel}>Title</label>
            <input value={form.title} onChange={(e) => updateForm({ title: e.target.value })} style={ytFieldInput} placeholder="Video title" />
            <label style={ytFieldLabel}>Privacy</label>
            <select value={form.privacyStatus} onChange={(e) => updateForm({ privacyStatus: e.target.value })} style={ytFieldInput}>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
            <button onClick={handleUpload} disabled={!form.title.trim()} style={{ ...ytPrimaryBtn, opacity: form.title.trim() ? 1 : 0.5, cursor: form.title.trim() ? 'pointer' : 'default' }}>
              <div style={{ width:13, height:13 }}><Icon.Upload /></div> Start Upload
            </button>
          </div>
        )}

        {status === 'uploading' && (
          <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'10px 0' }}>
            <div style={{ fontSize:12, color:'var(--panel-text-2)', textAlign:'center' }}>Uploading to YouTube... {progress}%</div>
            <div style={{ height:6, background:'var(--panel-surface-2)', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${progress}%`, background:'var(--danger)', transition:'width .2s' }} />
            </div>
          </div>
        )}

        {(status === 'details' || status === 'saved') && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.3)', borderRadius:8, color:'var(--success)', fontSize:12 }}>
              <div style={{ width:14, height:14 }}><Icon.Check /></div>
              {status === 'saved' ? 'Saved to YouTube.' : 'Uploaded! Now finish your details.'}
            </div>
            {videoUrl && (
              <a href={videoUrl} target="_blank" rel="noreferrer" style={{ fontSize:12, color:'var(--info-light)', display:'flex', alignItems:'center', gap:5, textDecoration:'none' }}>
                <div style={{ width:12, height:12 }}><Icon.Link /></div> View on YouTube
              </a>
            )}
            <label style={ytFieldLabel}>Title</label>
            <input value={form.title} onChange={(e) => updateForm({ title: e.target.value })} style={ytFieldInput} />
            <label style={ytFieldLabel}>Description</label>
            <textarea value={form.description} onChange={(e) => updateForm({ description: e.target.value })} style={{ ...ytFieldInput, minHeight:70, resize:'vertical', fontFamily:'inherit' }} placeholder="Tell viewers about this video..." />
            <label style={ytFieldLabel}>Tags (comma separated)</label>
            <input value={form.tags} onChange={(e) => updateForm({ tags: e.target.value })} style={ytFieldInput} placeholder="editing, tutorial, capcut" />
            <label style={ytFieldLabel}>Hashtags</label>
            <input value={form.hashtags} onChange={(e) => updateForm({ hashtags: e.target.value })} style={ytFieldInput} placeholder="#shorts #viral" />
            <label style={ytFieldLabel}>Privacy</label>
            <select value={form.privacyStatus} onChange={(e) => updateForm({ privacyStatus: e.target.value })} style={ytFieldInput}>
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
            </select>
            <button onClick={handleSaveDetails} disabled={saving} style={{ ...ytPrimaryBtn, opacity: saving ? 0.7 : 1, cursor: saving ? 'default' : 'pointer' }}>
              {saving ? (<><div style={{ width:13, height:13 }}><Icon.Spin /></div> Saving...</>) : (<><div style={{ width:13, height:13 }}><Icon.Check /></div> Save to YouTube</>)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SuccessPreview({ outputFile, loadVideoInEditor, onShurfer, onReset }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(1);
  const [prevVolume, setPrevVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showYoutubePanel, setShowYoutubePanel] = useState(false);
  const hideTimerRef = useRef(null);
  const src = outputFile.fileName ? `${API_BASE}/clips/${outputFile.fileName}` : '';

  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setShowControls(true);
    if (playing) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
    }
  }, [playing]);

  const toggle = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  }, []);

  const seek = useCallback((delta) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(dur, videoRef.current.currentTime + delta));
  }, [dur]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.muted || volume === 0) {
      videoRef.current.muted = false;
      const restore = prevVolume || 1;
      videoRef.current.volume = restore;
      setVolume(restore);
      setIsMuted(false);
    } else {
      setPrevVolume(volume);
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  }, [volume, prevVolume]);

  const changeVolume = (e) => {
    if (!videoRef.current) return;
    const newVolume = parseFloat(e.target.value);
    videoRef.current.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const changeSpeed = (rate) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      containerRef.current.requestFullscreen?.();
    }
  }, []);

  const handleProgressClick = (e) => {
    if (!videoRef.current || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    videoRef.current.currentTime = ((e.clientX - r.left) / r.width) * dur;
  };

  const handleDownload = async () => {
    if (!src) return;
    setIsDownloading(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outputFile.downloadName || outputFile.fileName || 'montage.mp4';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed', error);
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!videoRef.current) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          toggle();
          break;
        case 'arrowleft':
          e.preventDefault();
          seek(-5);
          break;
        case 'arrowright':
          e.preventDefault();
          seek(5);
          break;
        case 'arrowup':
          e.preventDefault();
          if (videoRef.current) {
            const newVol = Math.min(1, volume + 0.1);
            videoRef.current.volume = newVol;
            setVolume(newVol);
            setIsMuted(false);
          }
          break;
        case 'arrowdown':
          e.preventDefault();
          if (videoRef.current) {
            const newVol = Math.max(0, volume - 0.1);
            videoRef.current.volume = newVol;
            setVolume(newVol);
            setIsMuted(newVol === 0);
          }
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFullscreen();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [volume, dur, playing, toggle, seek, toggleMute, toggleFullscreen]);

  useEffect(() => {
    if (playing) {
      resetHideTimer();
    } else {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setShowControls(true);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, resetHideTimer]);

  const pct = dur ? (currentTime / dur) * 100 : 0;

  return (
    <div className="mt-fade-up" style={{ width:'100%', maxWidth:560, display:'flex', flexDirection:'column', gap:12 }}>
      {/* video player */}
      <div
        ref={containerRef}
        className="mt-video-container"
        style={{ position:'relative', borderRadius:14, overflow:'hidden', background:'#000', aspectRatio:'16/9', border:'1px solid var(--panel-surface-2)', cursor:'pointer' }}
        onMouseMove={resetHideTimer}
        onMouseLeave={() => playing && setShowControls(false)}
        onClick={toggle}
        onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
      >
        <video
          ref={videoRef}
          src={src}
          style={{ width:'100%', height:'100%', objectFit:'contain' }}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
          onLoadedMetadata={() => { setDur(videoRef.current?.duration || 0); setVolume(videoRef.current?.volume || 1); }}
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        {/* center play/pause overlay */}
        {!playing && (
          <div className="mt-video-overlay" style={{ opacity: 1, transition:'opacity .2s' }}>
            <div style={{ width:52, height:52, borderRadius:15, background:'rgba(124,58,237,.85)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', backdropFilter:'blur(4px)' }}>
              <div style={{ width:22, height:22, marginLeft:2 }}><Icon.Play /></div>
            </div>
          </div>
        )}

        {/* top controls */}
        <div style={{ position:'absolute', top:0, left:0, right:0, padding:'10px 12px', display:'flex', justifyContent:'space-between', opacity: showControls ? 1 : 0, transition:'opacity .25s', pointerEvents: showControls ? 'auto' : 'none' }}>
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={(e) => { e.stopPropagation(); seek(-10); }} style={{ width:32, height:32, borderRadius:8, background:'rgba(0,0,0,.5)', border:'none', color:'rgba(255,255,255,.85)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }} title="Back 10s">
              <div style={{ width:14, height:14 }}><Icon.SkipBack /></div>
            </button>
            <button onClick={(e) => { e.stopPropagation(); seek(10); }} style={{ width:32, height:32, borderRadius:8, background:'rgba(0,0,0,.5)', border:'none', color:'rgba(255,255,255,.85)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }} title="Forward 10s">
              <div style={{ width:14, height:14 }}><Icon.SkipForward /></div>
            </button>
          </div>
          <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} style={{ width:32, height:32, borderRadius:8, background:'rgba(0,0,0,.5)', border:'none', color:'rgba(255,255,255,.85)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }} title="Fullscreen">
            <div style={{ width:14, height:14 }}>{document.fullscreenElement ? <Icon.Minimize /> : <Icon.Maximize />}</div>
          </button>
        </div>

        {/* bottom controls */}
        <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'10px 12px', opacity: showControls ? 1 : 0, transition:'opacity .25s', pointerEvents: showControls ? 'auto' : 'none' }}>
          {/* progress bar */}
          <div style={{ position:'relative', height:14, display:'flex', alignItems:'center', cursor:'pointer', marginBottom:4 }} onClick={handleProgressClick}>
            <div style={{ position:'absolute', left:0, right:0, height:3, background:'rgba(255,255,255,.15)', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', background:'var(--accent-violet)', width:`${pct}%`, transition:'width .1s linear', borderRadius:99 }} />
            </div>
            <div style={{ position:'absolute', left:`${pct}%`, width:10, height:10, borderRadius:'50%', background:'#fff', transform:'translate(-50%, 0)', boxShadow:'0 0 4px rgba(0,0,0,.4)', transition:'left .1s linear' }} />
          </div>

          {/* controls row */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={(e) => { e.stopPropagation(); toggle(); }} style={{ width:32, height:32, borderRadius:8, background:'transparent', border:'none', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <div style={{ width:14, height:14 }}>{playing ? <Icon.Pause /> : <Icon.Play />}</div>
            </button>

            <button onClick={(e) => { e.stopPropagation(); seek(-5); }} style={{ width:28, height:28, borderRadius:6, background:'transparent', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }} title="Back 5s">
              <div style={{ width:12, height:12 }}><Icon.SkipBack /></div>
            </button>
            <button onClick={(e) => { e.stopPropagation(); seek(5); }} style={{ width:28, height:28, borderRadius:6, background:'transparent', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }} title="Forward 5s">
              <div style={{ width:12, height:12 }}><Icon.SkipForward /></div>
            </button>

            <span style={{ fontSize:12, color:'rgba(255,255,255,.7)', minWidth:72, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>
              {formatDuration(currentTime)} / {formatDuration(dur)}
            </span>

            <div style={{ flex:1 }} />

            {/* volume */}
            <div style={{ display:'flex', alignItems:'center', gap:4 }} onMouseEnter={() => setShowVolumeSlider(true)} onMouseLeave={() => setShowVolumeSlider(false)}>
              <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} style={{ width:28, height:28, borderRadius:6, background:'transparent', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <div style={{ width:14, height:14 }}>{isMuted || volume === 0 ? <Icon.VolumeMute /> : <Icon.VolumeUp />}</div>
              </button>
              <div style={{ width: showVolumeSlider ? 60 : 0, overflow:'hidden', transition:'width .2s' }}>
                <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={changeVolume} style={{ width:60, accentColor:'var(--accent-violet)', cursor:'pointer' }} />
              </div>
            </div>

            {/* speed */}
            <div style={{ position:'relative' }}>
              <button onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(!showSpeedMenu); }} style={{ height:28, padding:'0 8px', borderRadius:6, background:'transparent', border:'1px solid rgba(255,255,255,.15)', color:'rgba(255,255,255,.85)', cursor:'pointer', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
                {playbackRate}x <Icon.Settings />
              </button>
              {showSpeedMenu && (
                <div style={{ position:'absolute', bottom:36, right:0, background:'var(--panel-surface-1)', border:'1px solid var(--panel-border)', borderRadius:8, padding:4, display:'flex', flexDirection:'column', gap:2, zIndex:20, minWidth:72 }} onClick={(e) => e.stopPropagation()}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                    <button key={rate} onClick={() => changeSpeed(rate)} style={{ padding:'4px 10px', border:'none', borderRadius:4, background: rate === playbackRate ? 'rgba(124,58,237,.25)' : 'transparent', color: rate === playbackRate ? '#fff' : 'var(--panel-text-2)', cursor:'pointer', fontSize:12, textAlign:'left' }}>{rate}x</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* info + actions */}
      <div style={{ display:'flex', gap:10 }}>
        <div style={{ flex:1, padding:'10px 12px', background:'var(--panel-surface-0)', borderRadius:10, border:'1px solid var(--panel-surface-2)' }}>
          <div style={{ fontSize:12, fontWeight:600, color:'var(--panel-text-2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:4 }}>{outputFile.downloadName || outputFile.fileName}</div>
          <div style={{ fontSize:12, color:'var(--panel-border-strong)' }}>{formatDuration(outputFile.duration)} · {formatFileSize(outputFile.size)}</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <button onClick={handleDownload} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'var(--accent-violet)', border:'none', borderRadius:9, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            <div style={{ width:13, height:13 }}><Icon.Download /></div> {isDownloading ? 'Downloading...' : 'Download'}
          </button>
          <button onClick={() => loadVideoInEditor(outputFile.filePath, outputFile.fileName)} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'transparent', border:'1px solid rgba(124,58,237,.4)', borderRadius:9, color:'var(--accent-purple)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            <div style={{ width:13, height:13 }}><Icon.Edit /></div> Edit
          </button>
          <button onClick={() => setShowYoutubePanel(true)} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'rgba(255,0,51,.12)', border:'1px solid rgba(255,0,51,.35)', borderRadius:9, color:'var(--danger)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            <div style={{ width:13, height:13 }}><Icon.Youtube /></div> Upload to YouTube
          </button>
          <button onClick={onShurfer} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'rgba(34,197,94,.18)', border:'1px solid rgba(34,197,94,.32)', borderRadius:9, color:'var(--success)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            <div style={{ width:13, height:13 }}><Icon.Star /></div> Shurfer
          </button>
          <button onClick={onReset} style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'7px 14px', background:'transparent', border:'1px solid var(--panel-surface-3)', borderRadius:9, color:'var(--text-muted)', fontSize:12, cursor:'pointer' }}>
            New
          </button>
        </div>
      </div>
      {showYoutubePanel && <YouTubePublishPanel outputFile={outputFile} onClose={() => setShowYoutubePanel(false)} />}
    </div>
  );
}

function ErrorPreview({ error, onRetry }) {
  return (
    <div className="mt-fade-up" style={{ maxWidth:360, display:'flex', flexDirection:'column', alignItems:'center', gap:14, textAlign:'center' }}>
      <div style={{ width:56, height:56, borderRadius:16, background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--danger)' }}>
        <div style={{ width:24, height:24 }}><Icon.X /></div>
      </div>
      <div>
        <div style={{ fontSize:16, fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>Merge Failed</div>
        <div style={{ fontSize:12, color:'var(--text-muted)', fontFamily:'monospace', background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-2)', borderRadius:8, padding:'8px 12px', textAlign:'left', lineHeight:1.5 }}>{error}</div>
      </div>
      <button onClick={onRetry}
        style={{ padding:'8px 24px', background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)', borderRadius:9, color:'var(--danger)', fontSize:12, fontWeight:600, cursor:'pointer' }}>
        Try Again
      </button>
    </div>
  );
}

// ─── MontageTab ───────────────────────────────────────────────────────────────

export default function MontageTab({ loadVideoInEditor, onError, onShurfer, onReset }) {
  injectStyles();
  const { socket, socketId, socketError } = useSocket();

  // A `montageSession` URL param namespaces this tab's persisted state (see
  // usePersistedMontageState) so it can run a montage independently of any
  // other tab - see the "New" button below, which is how a second tab gets
  // one. Read once per mount; the value never needs to change within a
  // single page load.
  const [montageSessionId] = useState(() => new URLSearchParams(window.location.search).get('montageSession') || '');

  const montage = usePersistedMontageState(montageSessionId);
  const {
    videos,
    updateVideo,
    audio,
    setAudio,
    mergeStatus,
    setMergeStatus,
    mergeProgress,
    setMergeProgress,
    mergeStageText,
    setMergeStageText,
    mergeTotalEstimatedTime,
    setMergeTotalEstimatedTime,
    mergeTimeSpent,
    setMergeTimeSpent,
    mergeTimeLeft,
    setMergeTimeLeft,
    mergeError,
    setMergeError,
    mergeJobId,
    setMergeJobId,
    outputFile,
    hasRealProgress,
    setHasRealProgress,
    lastProgressUpdate,
    setLastProgressUpdate,
    syncMode,
    setSyncMode,
    tempoSensitivity,
    setTempoSensitivity,
    videoQuality,
    setVideoQuality,
    beautyStyle,
    setBeautyStyle,
    enhanceMotion,
    setEnhanceMotion,
    colorBoost,
    setColorBoost,
    smoothTransitions,
    setSmoothTransitions,
    contrastPolish,
    setContrastPolish,
    skipStartSeconds,
    setSkipStartSeconds,
    clearAll,
  } = montage;

  const handleReset = useCallback(() => {
    clearAll();
    onReset?.();
  }, [clearAll, onReset]);

  // Stable per-slot setters - MediaCard's internal effect re-subscribes its
  // socket listeners whenever `setItem` changes identity, so a fresh inline
  // arrow here on every render was tearing down/re-subscribing constantly.
  const setVideo0 = useCallback((u) => updateVideo(0, u), [updateVideo]);
  const setVideo1 = useCallback((u) => updateVideo(1, u), [updateVideo]);
  const setVideo2 = useCallback((u) => updateVideo(2, u), [updateVideo]);

  // Clip generation runs several ffmpeg processes concurrently (pLimit on
  // the backend), so their progress events don't arrive in percent order -
  // a later clip can report a higher percent before an earlier, still-
  // running clip's own lower-percent update lands. The bar's percent was
  // already guarded against moving backward (Math.max below), but the
  // stage text and time estimates were being overwritten unconditionally,
  // so a stale "Preparing clip 30/35..." from a lagging clip could land
  // after the bar had already moved on to merging, pairing a high percent
  // with a description of an earlier stage. Gate every field on this same
  // ref so a stale/out-of-order event is dropped in full rather than
  // partially applied.
  const maxProgressRef = useRef(0);

  useEffect(() => {
    if (!socket) return;
    const onProg = (p) => {
      // The server responds to the initial request as soon as the job is
      // accepted (see handleMerge) rather than holding the connection open
      // for the whole render - a screen lock, sleep/wake, or backgrounded
      // tab can no longer surface as a hard failure just because that one
      // long-lived connection dropped. Completion/result now arrive here
      // (or via the poller below) instead of the original fetch response.
      if (p?.percent >= 100 && p?.result) {
        montage.setOutputFile({
          filePath: p.result.filePath,
          fileName: p.result.fileName,
          downloadName: p.result.downloadName || p.result.fileName,
          duration: p.result.duration || 0,
          size: p.result.size || 0,
        });
        maxProgressRef.current = 100;
        setMergeStatus('success');
        setMergeProgress(100);
        setMergeStageText('Complete');
        return;
      }
      // Concurrent clip generation can deliver this event out of order (see
      // the ref's own comment above) - drop it whole rather than only
      // clamping the percent, so a lagging clip's stale text can never
      // pair with an already-higher percent.
      const incomingPercent = p?.percent || 0;
      if (incomingPercent < maxProgressRef.current) return;
      maxProgressRef.current = incomingPercent;

      setHasRealProgress(true);
      setMergeProgress(incomingPercent);
      setLastProgressUpdate(Date.now());
      setMergeStageText(p?.currentTime || '');
      setMergeTotalEstimatedTime(typeof p?.totalEstimatedTime === 'number' ? p.totalEstimatedTime : 0);
      setMergeTimeSpent(typeof p?.timeSpent === 'number' ? p.timeSpent : 0);
      setMergeTimeLeft(typeof p?.timeLeft === 'number' ? p.timeLeft : 0);
    };
    const onErr = (p) => {
      const message = p?.error || 'Failed to create montage';
      setMergeError(message);
      setMergeStatus('error');
      onError?.(message);
    };
    socket.on('montage-progress', onProg);
    socket.on('montage-error', onErr);
    return () => {
      socket.off('montage-progress', onProg);
      socket.off('montage-error', onErr);
    };
  }, [onError, socket, setHasRealProgress, setMergeProgress, setMergeStageText, setMergeStatus, setMergeError, setLastProgressUpdate, setMergeTimeLeft, setMergeTimeSpent, setMergeTotalEstimatedTime, montage.setOutputFile]);

  useEffect(() => {
    if (mergeStatus !== 'processing' || !mergeJobId) {
      return undefined;
    }
    const jobId = mergeJobId;

    // Poll the job-store-backed HTTP endpoint as a fallback so progress still
    // advances if the socket connection drops or reconnects mid-job. Keyed
    // by a fresh per-request jobId (not the socket connection, which is
    // reused across every montage a tab creates) so a new "Create new" run
    // can never read a previous run's stale terminal progress entry.
    const poller = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/create-montage/progress/${jobId}`, { cache: 'no-store' });
        if (!response.ok) return;
        const status = await response.json();
        if (status.error) {
          // The original request's own connection may have dropped (screen
          // lock/sleep, backgrounded tab, network blip) long before the
          // backend actually failed - this poller is what surfaces a real
          // failure now, instead of silently leaving the UI stuck at
          // whatever progress it last saw.
          setMergeError(status.error);
          setMergeStatus('error');
          onError?.(status.error);
          return;
        }
        if (status.percent >= 100 && status.result) {
          montage.setOutputFile({
            filePath: status.result.filePath,
            fileName: status.result.fileName,
            downloadName: status.result.downloadName || status.result.fileName,
            duration: status.result.duration || 0,
            size: status.result.size || 0,
          });
          maxProgressRef.current = 100;
          setMergeStatus('success');
          setMergeProgress(100);
          setMergeStageText('Complete');
          return;
        }
        // Same stale-event guard as the socket handler above (shared ref) -
        // the backend's progressByJob entry this polls is itself just the
        // latest of several concurrent clips' writes, so it can regress too.
        if (status.percent > 0 && status.percent >= maxProgressRef.current) {
          maxProgressRef.current = status.percent;
          setHasRealProgress(true);
          setMergeProgress(status.percent);
          setLastProgressUpdate(Date.now());
          if (status.currentTime) setMergeStageText(status.currentTime);
        }
      } catch { /* socket progress remains available */ }
    }, 1500);

    return () => window.clearInterval(poller);
  }, [mergeStatus, mergeJobId, setHasRealProgress, setMergeProgress, setMergeStageText, setLastProgressUpdate, setMergeStatus, setMergeError, onError, montage.setOutputFile]);

  useEffect(() => {
    if (mergeStatus !== 'processing') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      // Only creep forward during a genuine stall (no real backend update
      // for 5s+, e.g. during the initial probe/analysis phase before the
      // first clip event arrives) - this used to nudge the bar forward on
      // every tick regardless of whether real updates were flowing, which
      // raced it to 99% within ~90s no matter how long the actual render
      // took. Real montages (2-minute cap, dozens of clips) routinely run
      // longer than that, so the bar would sit pinned at 99% - detached
      // from the real percent - for most of the render while the stage
      // text (driven by real events) correctly kept crawling through
      // "Preparing clip N/M". Gating this on the stall check keeps the
      // displayed percent equal to the real percent whenever real updates
      // are actually arriving, so percent and text always describe the
      // same moment.
      if (Date.now() - lastProgressUpdate <= 5000) {
        return;
      }
      setMergeProgress((current) => {
        if (current >= 99) {
          return current;
        }
        const next = current < 92 ? current + 0.8 : current + 0.35;
        maxProgressRef.current = Math.max(maxProgressRef.current, next);
        return next;
      });
      setMergeStageText((current) => current || 'Preparing montage...');
    }, 700);

    return () => window.clearInterval(timer);
  }, [hasRealProgress, mergeStatus, lastProgressUpdate, setMergeProgress, setMergeStageText]);

  const isProcessing = mergeStatus === 'processing';
  const isSocketUnavailable = !socket && Boolean(socketError);
  const readyCount = videos.filter((v) => v.status === 'ready').length;
  const hasAudio = audio.status === 'ready';
  const canMerge = readyCount >= 2 && hasAudio && !isProcessing;

  const handleMerge = () => {
    if (!canMerge || isProcessing) return;
    // Read synchronously (not from mergeJobId state, which won't reflect
    // this until after the state update flushes) so it's available
    // immediately below for the X-Job-Id header.
    const newJobId = globalThis.crypto?.randomUUID?.() || `montage-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMergeJobId(newJobId);
    setMergeStatus('processing');
    setMergeProgress(0);
    setMergeStageText('Preparing upload...');
    setMergeError('');
    setHasRealProgress(false);
    maxProgressRef.current = 0;

    const fd = new FormData();
    videos.forEach((v, i) => {
      if (v.file) fd.append(`video${i + 1}`, v.file);
      else if (v.filePath) fd.append(`videoPath${i + 1}`, v.filePath);
    });
    if (audio.file) fd.append('audio', audio.file);
    else if (audio.filePath) fd.append('audioPath', audio.filePath);
    fd.append('audioLabel', audio.file?.name || audio.fileName || 'audio-track');
    fd.append('syncMode', syncMode);
    fd.append('tempoSensitivity', tempoSensitivity);
    fd.append('videoQuality', videoQuality);
    fd.append('beautyStyle', beautyStyle);
    fd.append('enhanceMotion', String(enhanceMotion));
    fd.append('colorBoost', String(colorBoost));
    fd.append('smoothTransitions', String(smoothTransitions));
    fd.append('contrastPolish', String(contrastPolish));
    fd.append('skipStartSeconds', String(skipStartSeconds));

    fetch(`${API_BASE}/api/create-montage`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Job-Id': newJobId,
        ...(socketId ? { 'X-Socket-Id': socketId } : {}),
      },
      body: fd,
    })
      .then((res) => {
        // The server now accepts the job and responds immediately (202 +
        // jobId) rather than holding this connection open for the whole
        // render - completion/errors arrive via the socket listener above
        // or the poller below instead of this response, so a screen
        // lock/sleep or backgrounded tab dropping THIS connection can no
        // longer surface as a hard failure partway through a real render.
        if (!res.ok) return res.json().then((data) => Promise.reject(new Error(data.error || 'Montage failed')));
        return res.json();
      })
      .catch((err) => {
        const msg = err.message || 'Failed to create montage';
        setMergeError(msg);
        setMergeStatus('error');
        onError?.(msg);
      });
  }

  // Lets a user start a second (or third...) montage while this one is
  // still rendering, without waiting for it or losing it. This tab's videos/
  // audio/progress are namespaced under montageSessionId (see
  // usePersistedMontageState) precisely so a second tab pointed at a fresh
  // session id can run fully independently - same origin, same localStorage,
  // but non-overlapping keys, so neither tab's autosave can stomp the
  // other's state. The backend already supports any number of concurrent
  // montage jobs (each gets its own jobId), so this is really just giving
  // the new tab its own workspace to kick one off from.
  const handleOpenNewMontageTab = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('montageSession', globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    window.open(url.toString(), '_blank', 'noopener');
  };

  return (
    <div style={{ width:'100%', height:'calc(100vh - 48px)', overflow:'hidden', background:'var(--panel-surface-0)', display:'flex', flexDirection:'column' }}>

      {/* ── Top bar */}
      <div style={{ height:52, background:'var(--panel-surface-0)', borderBottom:'1px solid var(--panel-surface-1)', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(124,58,237,.15)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent-violet)' }}>
            <div style={{ width:14, height:14 }}><Icon.Film /></div>
          </div>
          <span style={{ fontSize:13, fontWeight:600, color:'var(--accent-purple-light)', letterSpacing:'-0.01em' }}>Montage Creator</span>
          <span style={{ fontSize:12, color:'var(--panel-text-3)', marginLeft:4 }}>
            {readyCount === 0 ? 'add 3 videos and 1 audio track' : `${readyCount}/3 videos selected${hasAudio ? ' · audio ready' : ''}`}
          </span>
          {isSocketUnavailable && (
            <span style={{ fontSize:12, color:'var(--danger)', marginLeft:8 }}>
              {socketError}
            </span>
          )}
        </div>

        {/* merge button */}
        <button
          className="mt-merge-btn"
          disabled={!canMerge || isProcessing}
          onClick={handleMerge}
          style={{
            height:36, padding:'0 20px', borderRadius:10, border:'none', cursor: canMerge && !isProcessing ? 'pointer' : 'not-allowed',
            background: canMerge && !isProcessing ? 'var(--accent-violet)' : 'var(--panel-surface-1)',
            color: canMerge && !isProcessing ? '#fff' : 'var(--panel-text-3)',
            fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:8,
            transition:'all .2s', letterSpacing:'-0.01em',
            boxShadow: canMerge && !isProcessing ? '0 2px 12px rgba(124,58,237,.35)' : 'none',
          }}
        >
          {isProcessing ? (
            <><div style={{ width:14, height:14 }}><Icon.Spin /></div> Merging {Math.round(mergeProgress)}%</>
          ) : (
            <><div style={{ width:14, height:14 }}><Icon.Film /></div> Merge Montage</>
          )}
        </button>
      </div>

      {/* ── Body: source setup or preview page */}
      <div className="mt-body" style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        <div className="mt-main" style={{ flex:1, padding:'16px 20px', overflowY:'auto', overflowX:'hidden', minHeight:0, minWidth:0 }}>
          {mergeStatus === 'idle' ? (
            <div style={{ display:'flex', flexDirection:'column', gap:20, minWidth:0, minHeight:0 }}>
              <div style={{ borderRadius:22, background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-1)', padding:24, display:'flex', flexDirection:'column', gap:20 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:700, color:'var(--text-primary)' }}>Build your montage</div>
                  <div style={{ fontSize:12, color:'var(--panel-text-2)', marginTop:6 }}>Add at least two video clips, choose your audio track, then click Merge Montage to generate the preview.</div>
                </div>

                <div className="mt-video-grid">
                  <MediaCard label="Video Source 1" item={videos[0]} setItem={setVideo0} accept="video/*" type="video" onError={onError} animDelay="mt-stagger-1" />
                  <MediaCard label="Video Source 2" item={videos[1]} setItem={setVideo1} accept="video/*" type="video" onError={onError} animDelay="mt-stagger-2" />
                  <MediaCard label="Video Source 3" item={videos[2]} setItem={setVideo2} accept="video/*" type="video" onError={onError} animDelay="mt-stagger-3" />
                  <div className="mt-card mt-add-card" style={{ borderRadius:20, border:'1px dashed rgba(124,58,237,.3)', background:'var(--panel-surface-0)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:20, textAlign:'center', minHeight:210, cursor:'default' }}>
                    <div style={{ width:44, height:44, borderRadius:14, background:'rgba(124,58,237,.15)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent-purple)' }}><Icon.Plus /></div>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>Add more video</div>
                    <div style={{ fontSize:12, color:'var(--panel-text-3)', lineHeight:1.6 }}>Use extra clips to expand your montage rhythm and create a fuller story.</div>
                  </div>
                </div>
              </div>

              <div style={{ width:'100%', paddingTop:0, paddingBottom:8, display:'flex', justifyContent:'center' }}>
                <div style={{ width:'100%', maxWidth:920, minWidth:0 }}>
                  <AudioCard item={audio} setItem={setAudio} accept="audio/*" onError={onError} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ width:'100%', height:'100%', minHeight:360, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <div style={{ width:'100%', maxWidth:840, minHeight:280, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {mergeStatus === 'processing' && (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:18 }}>
                    <ProcessingPreview progress={mergeProgress} status={mergeStageText} totalEstimatedTime={mergeTotalEstimatedTime} timeSpent={mergeTimeSpent} timeLeft={mergeTimeLeft} />
                    <button
                      type="button"
                      onClick={handleOpenNewMontageTab}
                      title="Opens a new tab so you can start another montage while this one keeps rendering"
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 18px', background:'rgba(124,58,237,.12)', border:'1px solid rgba(124,58,237,.3)', borderRadius:10, color:'var(--accent-violet-light)', fontSize:12, fontWeight:600, cursor:'pointer' }}
                    >
                      <div style={{ width:14, height:14 }}><Icon.Plus /></div>
                      Create another montage
                    </button>
                  </div>
                )}
                {mergeStatus === 'success' && <SuccessPreview outputFile={outputFile} loadVideoInEditor={loadVideoInEditor} onShurfer={onShurfer} onReset={handleReset} />}
                {mergeStatus === 'error' && <ErrorPreview error={mergeError} onRetry={() => { setMergeStatus('idle'); setMergeError(''); setMergeProgress(0); setMergeStageText(''); }} />}
              </div>
            </div>
          )}
        </div>

        <div className="mt-side" style={{ display:'flex', flexDirection:'column', gap:18, overflowY:'auto', minHeight:0, padding:'16px 20px 16px 0' }}>
          <div style={{ borderRadius:22, background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-1)', padding:22, display:'flex', flexDirection:'column', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:36, height:36, borderRadius:12, background:'rgba(124,58,237,.14)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent-violet-light)' }}><Icon.Waveform /></div>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)' }}>Sync & output settings</div>
                <div style={{ fontSize:12, color:'var(--panel-text-3)' }}>Keep the montage aligned with the song beat and refine quality.</div>
              </div>
            </div>

            <div className="mt-config-group">
              <div className="mt-config-label">Sync mode</div>
              <div className="mt-pill-track">
                {['beat','scene','auto'].map((mode) => (
                  <button key={mode} type="button" className={`mt-pill-opt ${syncMode === mode ? 'active' : ''}`} onClick={() => setSyncMode(mode)}>
                    {mode === 'beat' ? 'Beat' : mode === 'scene' ? 'Scene' : 'Auto'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-config-group">
              <div className="mt-config-label">Tempo sensitivity</div>
              <div className="mt-pill-track">
                {['gentle','medium','aggressive'].map((level) => (
                  <button key={level} type="button" className={`mt-pill-opt ${tempoSensitivity === level ? 'active' : ''}`} onClick={() => setTempoSensitivity(level)}>
                    {level === 'gentle' ? 'Gentle' : level === 'medium' ? 'Medium' : 'Aggressive'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-config-group">
              <div className="mt-config-label">Video quality</div>
              <select className="mt-config-select" value={videoQuality} onChange={e => setVideoQuality(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
              </select>
            </div>

            <div className="mt-config-group">
              <div className="mt-config-label">Skip intro per video (sec)</div>
              <input
                type="number"
                className="mt-config-select"
                min={0}
                max={600}
                step={5}
                value={skipStartSeconds}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { setSkipStartSeconds(''); return; }
                  const n = Number(raw);
                  if (Number.isFinite(n)) setSkipStartSeconds(Math.max(0, Math.min(600, n)));
                }}
                onBlur={() => { if (skipStartSeconds === '' || Number.isNaN(Number(skipStartSeconds))) setSkipStartSeconds(40); }}
              />
              <div style={{ fontSize:12, color:'var(--panel-text-3)', lineHeight:1.5 }}>
                Clips are never pulled from the first N seconds of each source video (skips intros/setup footage). Default is 40s.
              </div>
            </div>

            <div className="mt-config-group">
              <div className="mt-config-label">Beauty style</div>
              <div className="mt-pill-track">
                {['cinematic','vivid','glow'].map((style) => (
                  <button key={style} type="button" className={`mt-pill-opt ${beautyStyle === style ? 'active' : ''}`} onClick={() => setBeautyStyle(style)}>
                    {style === 'cinematic' ? 'Cinematic' : style === 'vivid' ? 'Vivid' : 'Soft Glow'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-config-group" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <button type="button" className={`mt-config-toggle ${enhanceMotion ? 'active' : ''}`} onClick={() => setEnhanceMotion(prev => !prev)}>
                Motion accent
              </button>
              <button type="button" className={`mt-config-toggle ${colorBoost ? 'active' : ''}`} onClick={() => setColorBoost(prev => !prev)}>
                Color boost
              </button>
            </div>

            <div style={{ fontSize:12, color:'var(--panel-text-3)', lineHeight:1.6 }}>Use sync and beauty controls together to guide the montage toward a cinematic beat-driven edit.</div>
          </div>

          <div style={{ borderRadius:22, background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-1)', padding:18, display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)' }}>Creative boost</div>
            <div style={{ fontSize:12, color:'var(--panel-text-2)', lineHeight:1.6 }}>Try the settings above to make the generated clip more dynamic, vibrant, and polished.</div>
            <div style={{ display:'grid', gap:10, marginTop:8 }}>
              <button type="button" className={`mt-config-toggle ${smoothTransitions ? 'active' : ''}`} onClick={() => setSmoothTransitions(prev => !prev)}>
                Smooth transitions
              </button>
              <button type="button" className={`mt-config-toggle ${contrastPolish ? 'active' : ''}`} onClick={() => setContrastPolish(prev => !prev)}>
                Contrast polish
              </button>
            </div>
            <div style={{ display:'grid', gap:10, marginTop:8 }}>
              <div style={{ background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-2)', borderRadius:14, padding:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, color:'var(--accent-purple-light)' }}>Motion accent</span>
                <span style={{ fontSize:12, color:'var(--panel-text-2)' }}>{enhanceMotion ? 'On' : 'Off'}</span>
              </div>
              <div style={{ background:'var(--panel-surface-0)', border:'1px solid var(--panel-surface-2)', borderRadius:14, padding:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, color:'var(--accent-purple-light)' }}>Color boost</span>
                <span style={{ fontSize:12, color:'var(--panel-text-2)' }}>{colorBoost ? 'On' : 'Off'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
