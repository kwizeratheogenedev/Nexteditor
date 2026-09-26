import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import UserMenu from './UserMenu.jsx';
import CanvasSettingsMenu from './CanvasSettingsMenu';
import { setWorkspace } from '../analytics/tracker.js';

const CLOUD = 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9z';

const MODE_LABEL = { media: 'Montage', shorts: 'Shorts', longmix: 'LongMix Studio', captions: 'Captions' };

function TopBar({ activeTab, onExport, exporting = false, exportProgress = 0, projectName, currentProjectId, projectSyncStatus, onSaveProject, onOpenProjects, canvasSize, onCanvasSizeChange }) {
  const { user } = useAuth();

  // Lets usage analytics know which tool (Editor, Montage, ...) is open.
  useEffect(() => { setWorkspace(activeTab); }, [activeTab]);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);

  const handleSaveProject = async () => {
    if (!onSaveProject || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSaveProject(projectName);
    } catch (err) {
      setSaveError(err.code === 'UPGRADE_REQUIRED' ? 'Free plan limit reached (3 projects) - upgrade to save more.' : (err.message || 'Failed to save project.'));
    } finally {
      setSaving(false);
    }
  };

  const sync = currentProjectId
    ? (saving || projectSyncStatus === 'saving'
      ? { label: 'Saving…', tone: 'busy', title: 'Saving to your account' }
      : projectSyncStatus === 'error'
        ? { label: 'Sync error', tone: 'error', title: 'Could not save to your account - your changes are still here' }
        : { label: 'Saved to cloud', tone: 'cloud', title: 'Saved to your account - open it from any device' })
    : { label: 'Saved', tone: 'local', title: 'Saved in this browser. Save to your account to open it anywhere.' };

  const aspect = canvasSize?.aspectRatioId || '16:9';
  const resolution = canvasSize?.resolutionId || `${canvasSize?.height || 1080}p`;

  return (
    <header className="topbar st-topbar">
      <div className="topbar-left">
        <div className="brand-mark">
          <span className="brand-mark-primary">Nex</span>
          <span className="brand-mark-accent">Editor</span>
        </div>
        {activeTab === 'editor' && (
          <div className="st-project">
            <button type="button" className="st-project-name" onClick={onOpenProjects} title="Your projects">
              {projectName || 'Untitled project'}
            </button>
            <span className={`st-sync is-${sync.tone}`} title={sync.title}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d={CLOUD} /></svg>
              {sync.label}
            </span>
            {!currentProjectId && user && onSaveProject && (
              <button type="button" className="st-save-cloud" onClick={handleSaveProject} disabled={saving}>
                {saving ? 'Saving…' : 'Save to account'}
              </button>
            )}
            {saveError && <small className="st-save-error">{saveError}</small>}
          </div>
        )}
      </div>

      <div className="topbar-right">
        {activeTab === 'editor' ? (
          <>
            <span className="st-canvas-wrap">
              <button type="button" className="st-canvas-chip" onClick={() => setCanvasMenuOpen((v) => !v)} aria-expanded={canvasMenuOpen} title="Canvas size and frame rate">
                {aspect} · {resolution}
              </button>
              {canvasMenuOpen && onCanvasSizeChange && (
                <CanvasSettingsMenu canvasSize={canvasSize} onChange={onCanvasSizeChange} onClose={() => setCanvasMenuOpen(false)} />
              )}
            </span>
            <button type="button" className="topbar-export st-export" disabled={exporting} onClick={onExport}>
              {exporting ? `Exporting ${Math.round(exportProgress)}%` : 'Export'}
            </button>
          </>
        ) : (
          <span className="topbar-pill">{MODE_LABEL[activeTab] || 'Studio'}</span>
        )}
        <ThemeToggle />
        {user && <UserMenu />}
      </div>
    </header>
  );
}

export default TopBar;
