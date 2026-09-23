// Icon set matches the one used in the hero-section product demo
// (see HeroShowcase.jsx's own `I`/`Icon`) - same paths, same stroke-based
// rendering (viewBox 0 0 24 24, fill none, round caps/joins) so the real
// sidebar reads as the same design shown there.
const ICON_PATHS = {
  media: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5',
  edit: 'M3 7h18 M3 12h18 M3 17h18 M8 4v6 M15 9v6 M11 14v6',
  montage: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  captions: 'M3 5h18v14H3z M7 13h4 M13 13h4 M7 16h10',
  shorts: 'M8 3h8v18H8z M11 18h2',
  mix: 'M4 12h3l2-6 3 12 3-9 2 3h3',
  projects: 'M3 7h7l2 2h9v10H3z',
};

function ToolIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// Order and icons match the hero-section product demo's own sidebar (Media,
// Editor, Montage, Captions, Shorts, Long Mix, Projects). "Media" isn't
// included here - unlike the demo, this app has no standalone media-library
// tab of its own; importing files happens inside the Editor's own Media
// panel instead.
const tools = [
  { id: 'editor', label: 'Editor', icon: 'edit', tab: 'editor' },
  { id: 'media', label: 'Montage', icon: 'montage', tab: 'media' },
  { id: 'captions', label: 'Captions', icon: 'captions', tab: 'captions' },
  { id: 'shorts', label: 'Shorts', icon: 'shorts', tab: 'shorts' },
  { id: 'longmix', label: 'Long Mix', icon: 'mix', tab: 'longmix' },
];

function getActiveTool(activeTab) {
  if (activeTab === 'media') return 'media';
  if (activeTab === 'shorts') return 'shorts';
  if (activeTab === 'longmix') return 'longmix';
  if (activeTab === 'captions') return 'captions';
  if (activeTab === 'editor') return 'editor';
  return '';
}

function LeftSidebar({ activeTab, onSelect, onOpenProjects }) {
  const activeTool = getActiveTool(activeTab);

  return (
    <aside className="left-sidebar">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`tool-button ${activeTool === tool.id ? 'is-active' : ''}`}
          onClick={() => onSelect(tool.tab)}
        >
          <ToolIcon name={tool.icon} />
          <span>{tool.label}</span>
        </button>
      ))}
      {onOpenProjects && (
        <button type="button" className="tool-button" onClick={onOpenProjects}>
          <ToolIcon name="projects" />
          <span>Projects</span>
        </button>
      )}
    </aside>
  );
}

export default LeftSidebar;
