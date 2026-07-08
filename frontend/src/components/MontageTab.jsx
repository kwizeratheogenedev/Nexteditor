import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';
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
  Maximize: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
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
  .mt-card:hover { border-color: #2e2e3a !important; }
  .mt-card.is-ready { border-color: rgba(124,58,237,.4) !important; box-shadow: 0 0 0 1px rgba(124,58,237,.08), inset 0 1px 0 rgba(255,255,255,.03); }
  .mt-card.is-audio.is-ready { border-color: rgba(236,72,153,.4) !important; box-shadow: 0 0 0 1px rgba(236,72,153,.08), inset 0 1px 0 rgba(255,255,255,.03); }
  .mt-card.is-error { border-color: rgba(239,68,68,.35) !important; }

  .mt-thumb { position:relative; overflow:hidden; transition: all .2s; }
  .mt-thumb:hover .mt-thumb-overlay { opacity:1; }
  .mt-thumb-overlay { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .2s; }

  .mt-pill-track { background:#141418; border:1px solid #1e1e26; border-radius:10px; padding:3px; display:flex; }
  .mt-pill-opt { flex:1; font-size:11px; font-weight:500; padding:6px 0; border-radius:7px; text-align:center; transition:all .2s; cursor:pointer; color:#44445a; border:none; background:transparent; display:flex; align-items:center; justify-content:center; gap:5px; }
  .mt-pill-opt.active { background:#7c3aed; color:#fff; box-shadow:0 2px 8px rgba(124,58,237,.35); }
  .mt-pill-opt.active-audio { background:#db2777; color:#fff; box-shadow:0 2px 8px rgba(219,39,119,.35); }
  .mt-pill-opt:not(.active):not(.active-audio):hover { color:#888; }

  .mt-url-input { background:#0c0c10; border:1px solid #1e1e26; border-radius:8px; padding:8px 12px; font-size:12px; color:#e0e0f0; outline:none; transition:border-color .2s; width:100%; }
  .mt-url-input::placeholder { color:#33334a; }
  .mt-url-input:focus { border-color:rgba(124,58,237,.5); }

  .mt-merge-btn { position:relative; overflow:hidden; }
  .mt-merge-btn::before { content:''; position:absolute; inset:0; background:linear-gradient(135deg,rgba(255,255,255,.08) 0%,transparent 50%); pointer-events:none; }
  .mt-merge-btn:hover:not(:disabled)::after { content:''; position:absolute; inset:0; background:rgba(255,255,255,.06); }

  .mt-progress-bar { background: linear-gradient(90deg, #7c3aed, #a855f7, #7c3aed); background-size:200% 100%; animation: bar-shimmer 2s linear infinite; }

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

  const handleMode = (mode) => setItem(prev => ({ ...prev, sourceMode: mode, error: '' }));

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
  const accentClr = isAudio ? '#db2777' : '#7c3aed';

  return (
    <div
      className={`mt-card mt-fade-up ${animDelay} ${isReady ? (isAudio ? 'is-ready is-audio' : 'is-ready') : ''} ${isError ? 'is-error' : ''}`}
      style={{ background:'#0e0e14', border:'1px solid #1c1c24', borderRadius:16, overflow:'hidden', display:'flex', flexDirection:'column' }}
    >
      {/* ── Header */}
      <div style={{ padding:'14px 16px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #131318' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background: isAudio ? 'rgba(219,39,119,.12)' : 'rgba(124,58,237,.12)', display:'flex', alignItems:'center', justifyContent:'center', color:accentClr }}>
            <div style={{ width:16, height:16 }}>{isAudio ? <Icon.Music /> : <Icon.Film />}</div>
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:'#d0d0e8', letterSpacing:'-0.01em' }}>{label}</div>
            {isOptional && <div style={{ fontSize:10, color:'#383848', marginTop:1 }}>optional</div>}
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
              background:'#1e3a8a',
              border:'1px solid #2563eb',
              color:'#dbeafe',
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
          <button onClick={handleClear} style={{ width:26, height:26, borderRadius:7, background:'#18181f', border:'1px solid #222230', color:'#44445a', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background='rgba(239,68,68,.15)'; e.currentTarget.style.color='#ef4444'; e.currentTarget.style.borderColor='rgba(239,68,68,.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background='#18181f'; e.currentTarget.style.color='#44445a'; e.currentTarget.style.borderColor='#222230'; }}
          >
            <div style={{ width:12, height:12 }}><Icon.X /></div>
          </button>
        )}
      </div>

      {/* ── Thumbnail */}
      <div
        className="mt-thumb"
        onClick={() => !isLoading && item.sourceMode === 'device' && fileInputRef.current?.click()}
        style={{ margin:'12px 14px 0', borderRadius:10, background:'#080810', border:'1px solid #131320', aspectRatio:'16/9', cursor: (!isLoading && item.sourceMode === 'device') ? 'pointer' : 'default', position:'relative', overflow:'hidden' }}
      >
        {/* empty state */}
        {!isLoading && !isReady && (
          <>
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
              <div style={{ width:40, height:40, borderRadius:10, border:`1px dashed ${accentClr}33`, display:'flex', alignItems:'center', justifyContent:'center', color:`${accentClr}55` }}>
                <div style={{ width:20, height:20 }}>{isAudio ? <Icon.Music /> : <Icon.Plus />}</div>
              </div>
              <span style={{ fontSize:11, color:'#2e2e40' }}>
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
                    color:'#f5f3ff',
                    fontSize:11,
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
            <div style={{ width:100, height:2, background:'#1a1a24', borderRadius:99, overflow:'hidden' }}>
              <div className="mt-progress-bar" style={{ width:`${item.progress}%`, height:'100%', borderRadius:99, transition:'width .3s' }} />
            </div>
            <span style={{ fontSize:11, color:'#44445a' }}>{Math.round(item.progress)}%</span>
          </div>
        )}

        {/* video preview */}
        {isReady && !isAudio && <video ref={videoRef} muted autoPlay loop style={{ width:'100%', height:'100%', objectFit:'cover' }} />}

        {/* audio ready */}
        {isReady && isAudio && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, background:`linear-gradient(135deg,#0e0818,#0a0a14)` }}>
            <div style={{ color:'#db2777', opacity:.6 }}><div style={{ width:40, height:24 }}><Icon.Waveform /></div></div>
            <span style={{ fontSize:12, color:'#884466' }}>{formatDuration(item.duration)}</span>
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

      {/* ── Controls */}
      <div style={{ padding:'12px 14px 14px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>

        {!isLoading && !isReady && (
          <>
            {/* pill toggle */}
            <div className="mt-pill-track">
              <button className={`mt-pill-opt ${item.sourceMode === 'device' ? (isAudio ? 'active-audio' : 'active') : ''}`} onClick={() => handleMode('device')}>
                <div style={{ width:12, height:12 }}><Icon.Upload /></div> Device
              </button>
              <button className={`mt-pill-opt ${item.sourceMode === 'url' ? (isAudio ? 'active-audio' : 'active') : ''}`} onClick={() => handleMode('url')}>
                <div style={{ width:12, height:12 }}><Icon.Link /></div> URL
              </button>
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
                  color:isAudio ? '#f9a8d4' : '#c4b5fd',
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

            {/* url input */}
            {item.sourceMode === 'url' && (
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
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'#0a0a12', borderRadius:9, border:`1px solid ${accentClr}22` }}>
            <div style={{ width:20, height:20, borderRadius:6, background:`${accentClr}20`, display:'flex', alignItems:'center', justifyContent:'center', color:accentClr, flexShrink:0 }}>
              <div style={{ width:11, height:11 }}><Icon.Check /></div>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:11, color:'#b0b0cc', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.fileName}</div>
              <div style={{ fontSize:10, color:'#44445a', marginTop:1 }}>{formatDuration(item.duration)}</div>
            </div>
          </div>
        )}

        {/* error */}
        {isError && !isLoading && (
          <div style={{ display:'flex', alignItems:'flex-start', gap:8, padding:'8px 10px', background:'rgba(239,68,68,.06)', borderRadius:9, border:'1px solid rgba(239,68,68,.2)' }}>
            <span style={{ fontSize:11, color:'#f87171', lineHeight:1.4 }}>{item.error}</span>
          </div>
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
        <div style={{ fontSize:18, fontWeight:600, color:'#c0c0d8', letterSpacing:'-0.02em', marginBottom:6 }}>Montage Creator</div>
        <div style={{ fontSize:13, color:'#33334a', lineHeight:1.6 }}>
          {readyCount === 0 && 'Add 3 videos and 1 audio track to begin'}
          {readyCount === 1 && 'Add 2 more videos and your audio track'}
          {readyCount === 2 && 'Add 1 more video and your audio track'}
          {readyCount >= 3 && 'All video slots are ready. Add audio, then merge.'}
        </div>
      </div>
      {readyCount >= 3 && (
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 14px', background:'rgba(124,58,237,.1)', borderRadius:99, border:'1px solid rgba(124,58,237,.25)' }}>
          <div style={{ width:14, height:14, color:'#a78bfa' }}><Icon.Check /></div>
          <span style={{ fontSize:12, color:'#a78bfa', fontWeight:500 }}>Video slots ready</span>
        </div>
      )}
    </div>
  );
}

function ProcessingPreview({ progress, status }) {
  const fallbackStatus =
    progress < 15 ? 'Preparing montage...' :
    progress < 60 ? 'Creating random clips...' :
    progress < 95 ? 'Joining clips with audio...' : 'Finalizing output...';

  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;

  return (
    <div className="mt-fade-up" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, textAlign:'center' }}>
      <div style={{ position:'relative', width:120, height:120 }}>
        {/* pulse ring */}
        <div style={{ position:'absolute', inset:-8, borderRadius:'50%', border:'1px solid rgba(124,58,237,.15)', animation:'pulse-ring 2s ease-in-out infinite' }} />
        <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform:'rotate(-90deg)' }}>
          <circle cx="60" cy="60" r={r} fill="none" stroke="#141420" strokeWidth="6"/>
          <circle cx="60" cy="60" r={r} fill="none" stroke="#7c3aed" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset} style={{ transition:'stroke-dashoffset .5s cubic-bezier(.4,0,.2,1)' }} />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontSize:22, fontWeight:700, color:'#d0d0e8', letterSpacing:'-0.03em' }}>{Math.round(progress)}<span style={{ fontSize:13, color:'#7c3aed' }}>%</span></span>
        </div>
      </div>
      <div>
        <div style={{ fontSize:15, fontWeight:600, color:'#c0c0d8', marginBottom:6 }}>Creating Your Montage</div>
        <div style={{ fontSize:12, color:'#44445a' }}>{status || fallbackStatus}</div>
      </div>
    </div>
  );
}

function SuccessPreview({ outputFile, loadVideoInEditor, onShurfer, onReset }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const src = outputFile.fileName ? `${API_BASE}/clips/${outputFile.fileName}` : '';

  const toggle = () => {
    if (!videoRef.current) return;
    playing ? videoRef.current.pause() : videoRef.current.play();
    setPlaying(!playing);
  };

  const handleDownload = async () => {
    if (!src || isDownloading) return;

    try {
      setIsDownloading(true);
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error('Failed to download the montage');
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = outputFile.downloadName || outputFile.fileName || 'montage.mp4';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsDownloading(false);
    }
  };

  const pct = dur ? (currentTime / dur) * 100 : 0;

  return (
    <div className="mt-fade-up" style={{ width:'100%', maxWidth:560, display:'flex', flexDirection:'column', gap:16 }}>
      {/* video player */}
      <div className="mt-video-container" style={{ position:'relative', borderRadius:14, overflow:'hidden', background:'#000', aspectRatio:'16/9', border:'1px solid #1c1c28', cursor:'pointer' }} onClick={toggle}>
        <video ref={videoRef} src={src} style={{ width:'100%', height:'100%', objectFit:'contain' }}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDur(videoRef.current?.duration || 0)}
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        />
        <div className="mt-video-overlay">
          <div style={{ width:52, height:52, borderRadius:15, background:'rgba(124,58,237,.85)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', backdropFilter:'blur(4px)' }}>
            <div style={{ width:22, height:22, marginLeft: playing ? 0 : 2 }}>{playing ? <Icon.Pause /> : <Icon.Play />}</div>
          </div>
        </div>
        {/* fullscreen */}
        <button onClick={e => { e.stopPropagation(); videoRef.current?.requestFullscreen?.(); }}
          style={{ position:'absolute', top:10, right:10, width:30, height:30, borderRadius:8, background:'rgba(0,0,0,.55)', border:'none', color:'rgba(255,255,255,.7)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)' }}>
          <div style={{ width:14, height:14 }}><Icon.Maximize /></div>
        </button>
        {/* progress bar */}
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:'rgba(255,255,255,.08)' }}>
          <div style={{ height:'100%', background:'#7c3aed', width:`${pct}%`, transition:'width .1s linear' }} />
        </div>
      </div>

      {/* time + controls row */}
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={toggle} style={{ width:36, height:36, borderRadius:10, background:'#7c3aed', border:'none', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <div style={{ width:16, height:16, marginLeft: playing ? 0 : 1 }}>{playing ? <Icon.Pause /> : <Icon.Play />}</div>
        </button>
        <div style={{ flex:1 }}>
          <div style={{ height:3, background:'#1a1a24', borderRadius:99, overflow:'hidden', cursor:'pointer' }}
            onClick={e => { if (!videoRef.current || !dur) return; const r = e.currentTarget.getBoundingClientRect(); videoRef.current.currentTime = ((e.clientX - r.left) / r.width) * dur; }}>
            <div style={{ height:'100%', background:'#7c3aed', width:`${pct}%`, transition:'width .1s linear', borderRadius:99 }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
            <span style={{ fontSize:10, color:'#33334a' }}>{formatDuration(currentTime)}</span>
            <span style={{ fontSize:10, color:'#33334a' }}>{formatDuration(dur)}</span>
          </div>
        </div>
      </div>

      {/* info + actions */}
      <div style={{ display:'flex', gap:10 }}>
        {/* file info */}
        <div style={{ flex:1, padding:'10px 12px', background:'#0a0a12', borderRadius:10, border:'1px solid #1a1a24' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#b0b0c8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:4 }}>{outputFile.downloadName || outputFile.fileName}</div>
          <div style={{ fontSize:10, color:'#33334a' }}>{formatDuration(outputFile.duration)} · {formatFileSize(outputFile.size)}</div>
        </div>
        {/* action buttons */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <button onClick={handleDownload}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'#7c3aed', border:'none', borderRadius:9, color:'#fff', fontSize:11, fontWeight:600, textDecoration:'none', whiteSpace:'nowrap', cursor:'pointer', justifyContent:'center' }}>
            <div style={{ width:13, height:13 }}><Icon.Download /></div> {isDownloading ? 'Downloading...' : 'Download'}
          </button>
          <button onClick={() => loadVideoInEditor(outputFile.filePath, outputFile.fileName)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'transparent', border:'1px solid rgba(124,58,237,.4)', borderRadius:9, color:'#a78bfa', fontSize:11, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            <div style={{ width:13, height:13 }}><Icon.Edit /></div> Edit
          </button>
          <button onClick={onShurfer}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'rgba(34,197,94,.18)', border:'1px solid rgba(34,197,94,.32)', borderRadius:9, color:'#bef264', fontSize:11, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            <div style={{ width:13, height:13 }}><Icon.Star /></div> Shurfer
          </button>
          <button onClick={onReset}
            style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'7px 14px', background:'transparent', border:'1px solid #1e1e2a', borderRadius:9, color:'#44445a', fontSize:11, cursor:'pointer' }}>
            New
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorPreview({ error, onRetry }) {
  return (
    <div className="mt-fade-up" style={{ maxWidth:360, display:'flex', flexDirection:'column', alignItems:'center', gap:14, textAlign:'center' }}>
      <div style={{ width:56, height:56, borderRadius:16, background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', display:'flex', alignItems:'center', justifyContent:'center', color:'#ef4444' }}>
        <div style={{ width:24, height:24 }}><Icon.X /></div>
      </div>
      <div>
        <div style={{ fontSize:16, fontWeight:600, color:'#d0d0e8', marginBottom:8 }}>Merge Failed</div>
        <div style={{ fontSize:11, color:'#55556a', fontFamily:'monospace', background:'#080810', border:'1px solid #1a1a24', borderRadius:8, padding:'8px 12px', textAlign:'left', lineHeight:1.5 }}>{error}</div>
      </div>
      <button onClick={onRetry}
        style={{ padding:'8px 24px', background:'rgba(239,68,68,.15)', border:'1px solid rgba(239,68,68,.3)', borderRadius:9, color:'#f87171', fontSize:12, fontWeight:600, cursor:'pointer' }}>
        Try Again
      </button>
    </div>
  );
}

// ─── MontageTab ───────────────────────────────────────────────────────────────

export default function MontageTab({ loadVideoInEditor, onError }) {
  injectStyles();
  const { socket, socketId } = useSocket();

  const [videos, setVideos]         = useState([createVideoSlot(1), createVideoSlot(2), createVideoSlot(3)]);
  const [audio, setAudio]           = useState(createAudioSlot());
  const [mergeStatus, setMergeStatus] = useState('idle');
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStageText, setMergeStageText] = useState('');
  const [mergeError, setMergeError] = useState('');
  const [outputFile, setOutputFile] = useState({ filePath:'', fileName:'', downloadName:'', duration:'', size:'' });
  const [hasRealProgress, setHasRealProgress] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onProg = (p) => {
      setHasRealProgress(true);
      setMergeProgress(p?.percent || 0);
      setMergeStageText(p?.currentTime || '');
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
  }, [onError, socket]);

  useEffect(() => {
    if (mergeStatus !== 'processing' || hasRealProgress) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setMergeProgress((current) => {
        if (current >= 92) {
          return current;
        }
        if (current < 8) {
          return current + 2;
        }
        if (current < 35) {
          return current + 1.5;
        }
        if (current < 70) {
          return current + 1;
        }
        return current + 0.5;
      });
      setMergeStageText((current) => current || 'Preparing montage...');
    }, 700);

    return () => window.clearInterval(timer);
  }, [hasRealProgress, mergeStatus]);

  const updateVideo = (i, upd) => setVideos(prev => prev.map((v, ci) => ci === i ? (typeof upd === 'function' ? upd(v) : upd) : v));

  const readyCount = videos.filter(v => v.status === 'ready').length;
  const hasAudio = audio.status === 'ready';
  const canMerge = readyCount === 3 && hasAudio;

  const handleMerge = async () => {
    if (!canMerge || mergeStatus === 'processing') return;
    setMergeStatus('processing'); setMergeProgress(0); setMergeStageText('Preparing upload...'); setMergeError(''); setHasRealProgress(false);
    const fd = new FormData();
    videos.forEach((v, i) => {
      if (v.file) fd.append(`video${i+1}`, v.file);
      else if (v.filePath) fd.append(`video${i+1}Path`, v.filePath);
    });
    if (audio.file) fd.append('audio', audio.file);
    else if (audio.filePath) fd.append('audioPath', audio.filePath);
    fd.append('audioLabel', audio.file?.name || audio.fileName || 'audio-track');
    try {
      const res = await fetch(API_ENDPOINTS.createMontage, {
        method:'POST',
        headers: socketId ? { 'X-Socket-Id': socketId } : undefined,
        body:fd,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      const d = await res.json();
      setOutputFile({ filePath:d.filePath, fileName:d.fileName, downloadName:d.downloadName, duration:d.duration, size:d.size });
      setMergeStatus('success'); setMergeProgress(100); setMergeStageText('Complete');
    } catch (err) {
      const msg = err.message || 'An error occurred';
      setMergeError(msg); setMergeStatus('error');
      onError?.(msg);
    }
  };

  const handleReset = () => {
    setVideos([createVideoSlot(1), createVideoSlot(2), createVideoSlot(3)]);
    setAudio(createAudioSlot());
    setMergeStatus('idle'); setMergeProgress(0); setMergeStageText(''); setMergeError(''); setHasRealProgress(false);
    setOutputFile({ filePath:'', fileName:'', downloadName:'', duration:'', size:'' });
  };

  const isProcessing = mergeStatus === 'processing';

  return (
    <div style={{ width:'100%', height:'calc(100vh - 48px)', overflow:'hidden', background:'#080810', display:'flex', flexDirection:'column' }}>

      {/* ── Top bar */}
      <div style={{ height:52, background:'#0c0c14', borderBottom:'1px solid #14141e', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'rgba(124,58,237,.15)', display:'flex', alignItems:'center', justifyContent:'center', color:'#7c3aed' }}>
            <div style={{ width:14, height:14 }}><Icon.Film /></div>
          </div>
          <span style={{ fontSize:13, fontWeight:600, color:'#c0c0d8', letterSpacing:'-0.01em' }}>Montage Creator</span>
          <span style={{ fontSize:11, color:'#2a2a3a', marginLeft:4 }}>
            {readyCount === 0 ? 'add 3 videos and 1 audio track' : `${readyCount}/3 videos selected${hasAudio ? ' · audio ready' : ''}`}
          </span>
        </div>

        {/* merge button */}
        <button
          className="mt-merge-btn"
          disabled={!canMerge || isProcessing}
          onClick={handleMerge}
          style={{
            height:36, padding:'0 20px', borderRadius:10, border:'none', cursor: canMerge && !isProcessing ? 'pointer' : 'not-allowed',
            background: canMerge && !isProcessing ? '#7c3aed' : '#141420',
            color: canMerge && !isProcessing ? '#fff' : '#2a2a3a',
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

      {/* ── Body: preview left | cards right */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Preview pane */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:32, borderRight:'1px solid #10101a', background:'#080810' }}>
          {mergeStatus === 'idle'       && <IdlePreview readyCount={readyCount} />}
          {mergeStatus === 'processing' && <ProcessingPreview progress={mergeProgress} status={mergeStageText} />}
          {mergeStatus === 'success'    && <SuccessPreview outputFile={outputFile} loadVideoInEditor={loadVideoInEditor} onShurfer={onShurfer} onReset={handleReset} />}
          {mergeStatus === 'error'      && <ErrorPreview error={mergeError} onRetry={() => { setMergeStatus('idle'); setMergeError(''); setMergeProgress(0); setMergeStageText(''); }} />}
        </div>

        {/* Cards pane */}
        <div style={{ width:340, display:'flex', flexDirection:'column', gap:10, padding:'14px 14px', overflowY:'auto', background:'#0a0a12',
          scrollbarWidth:'thin', scrollbarColor:'#1a1a24 transparent' }}>

          <div style={{ fontSize:10, fontWeight:600, color:'#22223a', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:2 }}>Video Sources</div>

          <MediaCard label="Video 1" item={videos[0]} setItem={u => updateVideo(0,u)} accept="video/*" type="video" onError={onError} animDelay="mt-stagger-1" />
          <MediaCard label="Video 2" item={videos[1]} setItem={u => updateVideo(1,u)} accept="video/*" type="video" onError={onError} animDelay="mt-stagger-2" />
          <MediaCard label="Video 3" item={videos[2]} setItem={u => updateVideo(2,u)} accept="video/*" type="video" onError={onError} animDelay="mt-stagger-3" />

          <div style={{ fontSize:10, fontWeight:600, color:'#22223a', textTransform:'uppercase', letterSpacing:'.08em', margin:'6px 0 2px' }}>Audio Track</div>

          <MediaCard label="Background Audio" item={audio} setItem={setAudio} accept="audio/*" type="audio" onError={onError} isAudio animDelay="mt-stagger-4" />

          {/* spacer */}
          <div style={{ flex:1 }} />
        </div>
      </div>
    </div>
  );
}
