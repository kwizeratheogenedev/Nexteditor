function TopBar({ activeTab, onExport }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark">
          <span className="brand-mark-primary">Nex</span>
          <span className="brand-mark-accent">Editor</span>
        </div>
      </div>

      <div className="topbar-right">
        <span className="topbar-pill">{activeTab === 'editor' ? 'Editor Mode' : activeTab === 'media' ? 'Montage Mode' : activeTab === 'shorts' ? 'Shorts Mode' : 'Captions Mode'}</span>
        {activeTab === 'editor' && (
          <>
            <span className="topbar-pill">1080p</span>
            <span className="topbar-pill">16:9</span>
          </>
        )}
        <button type="button" className="topbar-export" onClick={onExport}>Export</button>
      </div>
    </header>
  );
}

export default TopBar;
