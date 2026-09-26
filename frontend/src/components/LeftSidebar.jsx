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

// Same order and icons as the hero demo: Media, Edit, Montage, Captions,
// Shorts, Long Mix, Projects. Media and Edit both open the editor - Media
// with the media bin in focus (nothing selected), Edit for working on clips.
const tools = [
  { id: 'library', label: 'Media', icon: 'media' },
  { id: 'editor', label: 'Edit', icon: 'edit' },
  { id: 'media', label: 'Montage', icon: 'montage' },
  { id: 'captions', label: 'Captions', icon: 'captions' },
  { id: 'shorts', label: 'Shorts', icon: 'shorts' },
  { id: 'longmix', label: 'Long Mix', icon: 'mix' },
];

function LeftSidebar({ activeTab, editorPane = 'edit', onSelect, onOpenProjects }) {
  const activeTool = activeTab === 'editor' ? (editorPane === 'media' ? 'library' : 'editor') : activeTab;

  return (
    <aside className="left-sidebar st-sidebar" aria-label="Tools">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`tool-button ${activeTool === tool.id ? 'is-active' : ''}`}
          aria-current={activeTool === tool.id ? 'page' : undefined}
          onClick={() => onSelect(tool.id)}
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
