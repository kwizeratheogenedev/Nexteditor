import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

function TopBar({ activeTab, onExport, exporting = false, exportProgress = 0, projectName, currentProjectId, projectSyncStatus, onSaveProject, onOpenProjects, canvasSize }) {
  const { user, logout } = useAuth();
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

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

  const syncLabel = currentProjectId
    ? (saving || projectSyncStatus === 'saving' ? 'Saving...' : projectSyncStatus === 'error' ? 'Sync error' : 'Saved to account')
    : 'Saved locally';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark">
          <span className="brand-mark-primary">Nex</span>
          <span className="brand-mark-accent">Editor</span>
        </div>
        {activeTab === 'editor' && (
          <div className="editor-project-title">
            <span style={{ cursor: onOpenProjects ? 'pointer' : 'default' }} onClick={onOpenProjects}>Projects</span>
            <i>/</i>
            <strong>{projectName || 'Untitled project'}</strong>
            {!currentProjectId && user && onSaveProject ? (
              <button type="button" className="topbar-pill" style={{ marginLeft: 8 }} onClick={handleSaveProject} disabled={saving}>
                {saving ? 'Saving...' : 'Save to account'}
              </button>
            ) : (
              <small>{syncLabel}</small>
            )}
            {saveError && <small style={{ color: 'var(--danger)', marginLeft: 8 }}>{saveError}</small>}
          </div>
        )}
      </div>

      <div className="topbar-right">
        <span className="topbar-pill">{activeTab === 'editor' ? 'Editor Mode' : activeTab === 'media' ? 'Montage Mode' : activeTab === 'shorts' ? 'Shorts Mode' : 'Captions Mode'}</span>
        {activeTab === 'editor' && (
          <>
            <span className="topbar-pill">{canvasSize?.resolutionId || `${canvasSize?.height || 1080}p`}</span>
            <span className="topbar-pill">{canvasSize?.aspectRatioId || '16:9'}</span>
            <button type="button" className="topbar-export" disabled={exporting} onClick={onExport}>
              {exporting ? `Exporting ${Math.round(exportProgress)}%` : 'Export'}
            </button>
          </>
        )}
        <ThemeToggle />
        {user && (
          <span className="topbar-pill" title={user.email} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={handleLogout}>
            {user.name || user.email}
            <span style={{ opacity: 0.6 }}>Log out</span>
          </span>
        )}
      </div>
    </header>
  );
}

export default TopBar;
