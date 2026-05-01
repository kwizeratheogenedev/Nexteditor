function TopBar({ activeTab, onTabChange, onExport }) {
  const tabs = [
    { id: 'editor', label: 'Editor' },
    { id: 'media', label: 'Montage' },
    { id: 'shorts', label: 'Shorts' },
    { id: 'captions', label: 'Captions' },
  ];

  const icons = {
    editor: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
    media: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>,
    shorts: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
    captions: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  };

  const logoIcon = <svg className="w-5 h-5 text-[#7c3aed]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>;

  return (
    <header className="flex items-center justify-between px-6 h-14 bg-[#0a0a0a] border-b border-[#1e1e1e] relative z-50">
      {/* LEFT SIDE — Logo */}
      <div className="flex items-center">
        <span className="text-white font-bold text-lg tracking-tight flex items-center gap-2">
          {logoIcon}
          Nex<span className="text-[#7c3aed]">Editor</span>
        </span>
      </div>

      {/* CENTER — Tab navigation (absolutely centered) */}
      <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#151515] border border-[#252525] rounded-xl p-1 shadow-lg" aria-label="Mode Tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === tab.id 
                ? 'text-white bg-[#7c3aed] shadow-md' 
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#1f1f1f]'}`}
            onClick={() => onTabChange(tab.id)}
          >
            {icons[tab.id]}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* RIGHT SIDE — Export controls */}
      <div className="flex items-center gap-3">
        {activeTab === 'editor' && (
          <>
            <span className="text-xs text-gray-400 bg-[#151515] border border-[#252525] px-3 py-1.5 rounded-lg">
              1080p
            </span>
            <span className="text-xs text-gray-400 bg-[#151515] border border-[#252525] px-3 py-1.5 rounded-lg">
              16:9
            </span>
            <button 
              type="button" 
              className="text-sm text-white bg-[#7c3aed] hover:bg-[#6d28d9] px-5 py-2 rounded-lg font-medium transition-all duration-200 shadow-md hover:shadow-lg"
              onClick={onExport}
            >
              Export
            </button>
          </>
        )}
      </div>
    </header>
  );
}

export default TopBar;
