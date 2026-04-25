function TopBar({ activeTab, onTabChange, onExport }) {
  const tabs = [
    { id: 'editor', label: 'Editor' },
    { id: 'media', label: 'Montage' },
    { id: 'shorts', label: 'Shorts' },
    { id: 'captions', label: 'Captions' },
  ];

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark" aria-label="NexEditor">
          <span className="brand-mark-primary">Nex</span>
          <span className="brand-mark-accent">Editor</span>
        </div>
        <nav className="topbar-tabs" aria-label="Mode Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`topbar-tab ${activeTab === tab.id ? 'is-active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="topbar-right">
        <button type="button" className="topbar-pill">1080p</button>
        <button type="button" className="topbar-pill">16:9</button>
        <button type="button" className="topbar-export" onClick={onExport}>Export</button>
      </div>
    </header>
  );
}

export default TopBar;
