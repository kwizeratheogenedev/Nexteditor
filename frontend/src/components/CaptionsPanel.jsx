import { useEffect, useMemo, useState } from 'react';
import './CaptionsPanel.css';

const CaptionIcon = ({ children, viewBox = '0 0 24 24' }) => (
  <svg viewBox={viewBox} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CaptionsPanel({
  captionVideo,
  captionVideoRef,
  captionFile,
  captionRef,
  handleCaptionSelect,
  captionVideoMeta,
  captionFileMeta,
  onGenerate,
  processing = false,
  progress = 0,
  progressText = '',
  resultUrl,
}) {
  const [activeMode, setActiveMode] = useState('auto');
  const [language, setLanguage] = useState('English (US)');
  const [removeFillers, setRemoveFillers] = useState(true);
  const [captionPosition, setCaptionPosition] = useState('bottom');
  const [selectedPreviewMode, setSelectedPreviewMode] = useState(null);

  const previewUrl = useMemo(() => (captionVideo ? URL.createObjectURL(captionVideo) : ''), [captionVideo]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const videoName = captionVideo?.name || captionVideoMeta?.name;
  const subtitleName = captionFile?.name || captionFileMeta?.name;
  const hasReadyFiles = activeMode === 'local' ? Boolean(captionVideo && captionFile) : Boolean(captionVideo);
  const previewMode = selectedPreviewMode || (resultUrl ? 'captioned' : 'original');
  const displayedVideoUrl = previewMode === 'captioned' && resultUrl ? resultUrl : previewUrl;
  const captionedDownloadName = `${(captionVideo?.name || captionVideoMeta?.name || 'video').replace(/\.[^.]+$/, '')}-captioned.mp4`;

  const modes = [
    { id: 'auto', label: 'Auto captions', badge: 'AI' },
    { id: 'lyrics', label: 'Auto lyrics', badge: 'AI' },
    { id: 'local', label: 'Local captions' },
  ];

  return (
    <div className="captions-workspace">
      <header className="captions-heading">
        <div>
          <span className="captions-kicker">TEXT · CAPTIONS</span>
          <h1>Create captions</h1>
          <p>Turn speech into polished, readable captions for your video.</p>
        </div>
        <div className="caption-step-pill"><span>1</span> Add media <i /> <span>2</span> Generate</div>
      </header>

      <nav className="caption-mode-tabs" aria-label="Caption type">
        {modes.map((mode) => (
          <button key={mode.id} type="button" disabled={processing} className={activeMode === mode.id ? 'is-active' : ''} onClick={() => setActiveMode(mode.id)}>
            {mode.label}{mode.badge && <em>{mode.badge}</em>}
          </button>
        ))}
      </nav>

      <div className="caption-main-grid">
        <section className="caption-preview-card">
          <div className="caption-card-title">
            <div><strong>{previewMode === 'captioned' && resultUrl ? 'Captioned preview' : 'Video preview'}</strong><span>{resultUrl ? 'Compare your original and generated video' : videoName ? 'Ready for captions' : 'Import a video to begin'}</span></div>
            <div className="caption-preview-actions">
              {resultUrl && (
                <div className="caption-preview-toggle">
                  <button type="button" className={previewMode === 'original' ? 'is-active' : ''} onClick={() => setSelectedPreviewMode('original')}>Original</button>
                  <button type="button" className={previewMode === 'captioned' ? 'is-active' : ''} onClick={() => setSelectedPreviewMode('captioned')}>Captioned</button>
                </div>
              )}
              {videoName && <button type="button" className="caption-text-button" onClick={() => captionVideoRef.current?.click()}>Replace</button>}
            </div>
          </div>

          <button type="button" className={`caption-video-stage ${videoName ? 'has-video' : ''}`} onClick={() => !videoName && captionVideoRef.current?.click()}>
            {displayedVideoUrl ? (
              <video key={displayedVideoUrl} src={displayedVideoUrl} controls onClick={(event) => event.stopPropagation()} />
            ) : (
              <div className="caption-empty-video">
                <span className="caption-upload-icon"><CaptionIcon><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></CaptionIcon></span>
                <strong>Upload your video</strong>
                <span>Drag and drop, or choose a file</span>
                <small>MP4, MOV, WebM · up to 2 GB</small>
              </div>
            )}
          </button>
          <input type="file" accept="video/*" ref={captionVideoRef} onChange={(event) => handleCaptionSelect(event, true)} className="sr-only-input" />

          {videoName && (
            <div className="caption-file-row">
              <span className="caption-file-icon"><CaptionIcon><path d="M15 10l4.5-2.5v9L15 14"/><rect x="3" y="5" width="12" height="14" rx="2"/></CaptionIcon></span>
              <div><strong>{videoName}</strong><span>{formatFileSize(captionVideo?.size || captionVideoMeta?.size)} · Video</span></div>
              <span className="caption-ready-mark">✓</span>
            </div>
          )}
        </section>

        <section className="caption-settings-card">
          {activeMode === 'local' ? (
            <>
              <div className="caption-card-title"><div><strong>Upload captions</strong><span>Use an existing subtitle file</span></div></div>
              <button type="button" className={`caption-subtitle-drop ${subtitleName ? 'has-file' : ''}`} onClick={() => captionRef.current?.click()}>
                <span className="caption-doc-icon"><CaptionIcon><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></CaptionIcon></span>
                <span><strong>{subtitleName || 'Choose a subtitle file'}</strong><small>{subtitleName ? `${formatFileSize(captionFile?.size || captionFileMeta?.size)} · Click to replace` : 'SRT or VTT · timestamps included'}</small></span>
                <b>{subtitleName ? '✓' : 'Browse'}</b>
              </button>
              <input type="file" accept=".srt,.vtt" ref={captionRef} onChange={(event) => handleCaptionSelect(event, false)} className="sr-only-input" />

              <div className="caption-info-box"><CaptionIcon><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></CaptionIcon><span>Your caption timing and text will be preserved and burned into the exported video.</span></div>
            </>
          ) : (
            <>
              <div className="caption-card-title"><div><strong>{activeMode === 'auto' ? 'Auto captions' : 'Auto lyrics'}</strong><span>{activeMode === 'auto' ? 'Recognize speech from your video' : 'Sync lyrics to music automatically'}</span></div><span className="caption-soon">AI</span></div>
              <label className="caption-field"><span>Spoken language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option>English (US)</option><option>English (UK)</option><option>Spanish</option><option>French</option><option>German</option></select></label>
              <label className="caption-toggle-row"><span><strong>Remove filler words</strong><small>Clean up “um”, “uh”, and repeated words</small></span><input type="checkbox" checked={removeFillers} onChange={(event) => setRemoveFillers(event.target.checked)} /><i /></label>
              <div className="caption-info-box"><CaptionIcon><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></CaptionIcon><span>Audio is optimized before transcription, then the generated captions are rendered directly into your video.</span></div>
            </>
          )}

          <label className="caption-field">
            <span>Caption position</span>
            <select value={captionPosition} onChange={(event) => setCaptionPosition(event.target.value)}>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </label>

          <div className="caption-action-area">
            {resultUrl && (
              <div className="caption-result-card">
                <span className="caption-ready-mark">✓</span>
                <div><strong>Captioned video is ready</strong><small>Your subtitles were added successfully.</small></div>
                <a href={resultUrl} download={captionedDownloadName}>Download</a>
              </div>
            )}
            {processing && <div className="caption-progress"><span style={{ width: `${progress}%` }} /></div>}
            <button type="button" className="caption-generate-button" disabled={!hasReadyFiles || processing} onClick={() => onGenerate(activeMode, { language, removeFillers, captionPosition })}>
              <CaptionIcon><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></CaptionIcon>
              {processing ? `Generating ${activeMode === 'lyrics' ? 'lyrics' : 'captions'} ${Math.round(progress)}%` : activeMode === 'local' ? 'Generate captioned video' : activeMode === 'lyrics' ? 'Generate lyrics' : 'Generate captions'}
            </button>
            <small>{processing ? (progressText || `Preparing ${activeMode === 'lyrics' ? 'lyrics' : 'captions'}...`) : activeMode === 'local' ? (hasReadyFiles ? 'Your video and captions are ready.' : 'Add both a video and subtitle file to continue.') : (hasReadyFiles ? 'Ready to recognize speech.' : 'Add a video to continue.')}</small>
          </div>
        </section>
      </div>
    </div>
  );
}

export default CaptionsPanel;
