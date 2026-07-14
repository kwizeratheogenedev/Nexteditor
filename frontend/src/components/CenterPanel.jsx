import CaptionsPanel from './CaptionsPanel';
import ShortsPanel from './ShortsPanel';
import EditorPanel from './EditorPanel';
import MontageTab from './MontageTab';

function formatTimecode(value) {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getModePanel(activeTab, mediaProps, captionsProps, shortsProps) {
  if (activeTab === 'media') return <MontageTab {...mediaProps} />;
  if (activeTab === 'captions') return <CaptionsPanel {...captionsProps} />;
  if (activeTab === 'shorts') return <ShortsPanel {...shortsProps} />;
  return null;
}

function CenterPanel({ activeTab, mediaProps, captionsProps, shortsProps, previewCurrentTime, previewDuration, previewIsPlaying, onTogglePlayback, onSeek, onStep, onFullscreen, editorProps }) {
  if (activeTab === 'editor') {
    const filledWidth = previewDuration > 0 ? `${(previewCurrentTime / previewDuration) * 100}%` : '0%';
    return <section className="center-panel"><div className="preview-area"><EditorPanel {...editorProps}/></div><div className="preview-controls"><div className="transport-group"><button type="button" className="transport-button" aria-label="Go to start" onClick={() => onSeek(0)}>⏮</button><button type="button" className="transport-button" aria-label="Step backward" onClick={() => onStep(-2)}>◀</button><button type="button" className="transport-button is-play" aria-label={previewIsPlaying ? 'Pause' : 'Play'} onClick={onTogglePlayback}>{previewIsPlaying ? 'Ⅱ' : '▶'}</button><button type="button" className="transport-button" aria-label="Step forward" onClick={() => onStep(2)}>▶</button><button type="button" className="transport-button" aria-label="Go to end" onClick={() => onSeek(previewDuration || 0)}>⏭</button></div><div className="timecode-display">{`${formatTimecode(previewCurrentTime)} / ${formatTimecode(previewDuration)}`}</div><button type="button" className="progress-track" aria-label="Seek video" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const percent = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0; onSeek((previewDuration || 0) * Math.max(0, Math.min(percent, 1))); }}><span className="progress-track-fill" style={{ width: filledWidth }}/></button><button type="button" className="transport-button" aria-label="Fullscreen" onClick={onFullscreen}>⛶</button></div></section>;
  }

  return <section className="center-panel"><div className="mode-panel-host">{getModePanel(activeTab, mediaProps, captionsProps, shortsProps)}</div></section>;
}

export default CenterPanel;
