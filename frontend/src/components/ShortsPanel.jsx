import { useEffect, useMemo, useState } from 'react';
import './ShortsPanel.css';

const ShortIcon = ({ children }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function ShortsPanel({
  shortsVideo,
  shortsVideoRef,
  handleVideoSelect,
  setShortsVideo,
  shortsVideoMeta,
  setShortsVideoMeta,
  duration,
  setDuration,
  format,
  setFormat,
  onGenerate,
  processing = false,
  progress = 0,
  progressText = '',
  results = [],
  selectedShortId,
  onSelectShort,
  onDownload,
  onReformat,
}) {
  const [reformattingId, setReformattingId] = useState(null);

  const handleReformatClick = async (event, clip, formatStrategy) => {
    event.stopPropagation();
    if (!onReformat || reformattingId) return;
    setReformattingId(clip.id);
    try {
      await onReformat(clip, formatStrategy);
    } finally {
      setReformattingId(null);
    }
  };
  const [sourceDuration, setSourceDuration] = useState(0);
  const previewUrl = useMemo(() => (shortsVideo ? URL.createObjectURL(shortsVideo) : ''), [shortsVideo]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const videoName = shortsVideo?.name || shortsVideoMeta?.name;
  const durations = [
    { value: '60', label: 'Under 60s', hint: 'Fast & punchy' },
    { value: '90', label: '60–90s', hint: 'More context' },
    { value: '180', label: '90s–3m', hint: 'Story format' },
  ];

  return (
    <div className="shorts-workspace">
      <header className="shorts-heading">
        <div><span className="shorts-kicker">AI TOOLS · REPURPOSE</span><h1>Long video to shorts</h1><p>Find strong moments and turn them into ready-to-share clips.</p></div>
        <div className="shorts-steps"><span className="is-active"><b>1</b> Add video</span><i/><span><b>2</b> Set style</span><i/><span><b>3</b> Get shorts</span></div>
      </header>

      <div className="shorts-main-grid">
        <section className="shorts-source-card">
          <div className="shorts-card-head"><div><strong>Source video</strong><span>{videoName ? `${formatFileSize(shortsVideo?.size || shortsVideoMeta?.size)} · ${sourceDuration ? formatTime(sourceDuration) : 'Ready'}` : 'Upload a long-form video'}</span></div>{videoName && <button type="button" onClick={() => shortsVideoRef.current?.click()}>Replace</button>}</div>
          <button type="button" className={`shorts-video-stage ${previewUrl ? 'has-video' : ''}`} onClick={() => !previewUrl && shortsVideoRef.current?.click()}>
            {previewUrl ? <video src={previewUrl} controls onLoadedMetadata={(event) => setSourceDuration(event.currentTarget.duration || 0)} onClick={(event) => event.stopPropagation()} /> : <div className="shorts-empty"><span><ShortIcon><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></ShortIcon></span><strong>Drop in your long video</strong><small>MP4, MOV or WebM · up to 500 MB</small><b>Choose video</b></div>}
          </button>
          <input type="file" accept="video/*" ref={shortsVideoRef} onChange={(event) => handleVideoSelect(event, setShortsVideo, setShortsVideoMeta, 'Source Video')} className="sr-only-input" />

          {videoName && <div className="shorts-selection"><div className="shorts-selection-top"><span>Analyze range</span><b>{formatTime(0)} — {formatTime(sourceDuration)}</b></div><div className="shorts-filmstrip">{Array.from({ length: 9 }, (_, index) => <span key={index} style={{ opacity: .34 + (index % 3) * .12 }} />)}<i className="shorts-range" /></div><div className="shorts-ruler"><span>Start</span><span>Full video selected</span><span>End</span></div></div>}
        </section>

        <section className="shorts-settings-card">
          <div className="shorts-card-head"><div><strong>Shorts setup</strong><span>Choose where and how your clips will play</span></div><span className="shorts-ai-badge">SMART CLIPS</span></div>

          <div className="shorts-setting-group"><label>Destination</label><div className="shorts-platforms"><button type="button" className={format === '9:16' ? 'is-active' : ''} onClick={() => setFormat('9:16')}><span className="shorts-ratio portrait"/><div><strong>Vertical 9:16</strong><small>TikTok · Reels · Shorts</small></div><b>✓</b></button><button type="button" className={format === '16:9' ? 'is-active' : ''} onClick={() => setFormat('16:9')}><span className="shorts-ratio landscape"/><div><strong>Landscape 16:9</strong><small>YouTube · X · LinkedIn</small></div><b>✓</b></button></div></div>

          <div className="shorts-setting-group"><label>Length of each short</label><div className="shorts-duration-list">{durations.map((item) => <button key={item.value} type="button" className={duration === item.value ? 'is-active' : ''} onClick={() => setDuration(item.value)}><span>{duration === item.value ? '●' : '○'}</span><div><strong>{item.label}</strong><small>{item.hint}</small></div></button>)}</div></div>

          <div className="shorts-smart-note"><ShortIcon><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/></ShortIcon><div><strong>Balanced clip selection</strong><span>NexEditor selects distinct moments across the full video and reframes them for your chosen format.</span></div></div>

          <div className="shorts-action-area">{processing && <div className="shorts-progress"><span style={{ width: `${Math.max(2, progress)}%` }}/></div>}<button type="button" className="shorts-generate" disabled={!shortsVideo || processing} onClick={onGenerate}><ShortIcon><path d="M8 5v14l11-7z"/></ShortIcon>{processing ? `Creating shorts ${Math.round(progress)}%` : 'Get shorts'}</button><small>{processing ? (progressText || 'Finding the best moments…') : shortsVideo ? 'Ready to analyze your video.' : 'Upload a video to continue.'}</small></div>
        </section>
      </div>

      {results.length > 0 && <section className="shorts-results"><div className="shorts-results-head"><div><span className="shorts-kicker">YOUR CLIPS</span><h2>{results.length} shorts are ready</h2><p>Preview your clips and download the ones you want to publish.</p></div><span className="shorts-ready-pill">✓ Generation complete</span></div><div className="shorts-results-grid">{results.map((clip, index) => <article key={clip.id} className={`shorts-result-card ${selectedShortId === clip.id ? 'is-selected' : ''}`} onClick={() => onSelectShort?.(clip.id)}><div className="shorts-result-video"><video src={clip.url} controls preload="metadata" onClick={(event) => event.stopPropagation()} /><span>#{index + 1}</span></div><div className="shorts-result-info"><div><strong>Short {index + 1}</strong><span>{formatTime(clip.duration)} · starts at {formatTime(clip.startTime)}</span></div><button type="button" onClick={(event) => { event.stopPropagation(); onDownload?.(clip, index); }}><ShortIcon><path d="M12 3v12m0 0l4-4m-4 4l-4-4"/><path d="M5 19h14"/></ShortIcon>Download</button></div>{onReformat && <div className="shorts-reformat-row" onClick={(event) => event.stopPropagation()}><span>Reframe:</span><button type="button" disabled={reformattingId === clip.id} onClick={(event) => handleReformatClick(event, clip, 'crop')}>{reformattingId === clip.id ? 'Working…' : 'Crop to fill'}</button><button type="button" disabled={reformattingId === clip.id} onClick={(event) => handleReformatClick(event, clip, 'pad')}>{reformattingId === clip.id ? 'Working…' : 'Fit with padding'}</button></div>}</article>)}</div></section>}
    </div>
  );
}

export default ShortsPanel;
