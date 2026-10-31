import CaptionsPanel from './CaptionsPanel';
import ShortsPanel from './ShortsPanel';
import LongMixPanel from './LongMixPanel';
import EditorPanel from './EditorPanel';
import MontageTab from './MontageTab';
import AudioMergePanel from './AudioMergePanel';

function getModePanel(activeTab, mediaProps, captionsProps, shortsProps, longMixProps, audioMergeProps) {
  if (activeTab === 'media') return <MontageTab {...mediaProps} />;
  if (activeTab === 'captions') return <CaptionsPanel {...captionsProps} />;
  if (activeTab === 'shorts') return <ShortsPanel {...shortsProps} />;
  if (activeTab === 'longmix') return <LongMixPanel {...longMixProps} />;
  if (activeTab === 'audiomerge' && audioMergeProps) return <AudioMergePanel {...audioMergeProps} />;
  return null;
}

function CenterPanel({ activeTab, mediaProps, captionsProps, shortsProps, longMixProps, audioMergeProps, onFullscreen, editorProps }) {
  if (activeTab === 'editor') {
    return <section className="center-panel st-center"><EditorPanel {...editorProps} onFullscreen={onFullscreen} /></section>;
  }

  return <section className="center-panel"><div className="mode-panel-host">{getModePanel(activeTab, mediaProps, captionsProps, shortsProps, longMixProps, audioMergeProps)}</div></section>;
}

export default CenterPanel;
