function GridIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="11" y="2" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="2" y="11" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="11" y="11" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M11.5 3v8.2a2.7 2.7 0 1 1-1-2.1V5.4l5-1.2v6a2.7 2.7 0 1 1-1-2.1V2.1Z" fill="currentColor" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <rect x="3" y="3" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="8" y="5" width="2" height="10" rx="1" fill="currentColor" />
      <rect x="5" y="13" width="8" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="m9 2.2 2 4 4.4.6-3.2 3.1.8 4.4L9 12.2l-4 2.1.8-4.4L2.6 6.8 7 6.2Z" fill="currentColor" />
    </svg>
  );
}

function WandIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 13.1 12.6 4.5l.9.9L4.9 14ZM12.5 2l.7 1.7L15 4.5l-1.8.8-.7 1.7-.7-1.7L10 4.5l1.8-.8ZM14.8 8l.4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4ZM9.2 7.3l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z" fill="currentColor" />
    </svg>
  );
}

function LongMixIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2.5 12.5v-3M5.5 14V4M8.5 12V6M11.5 15V3M14.5 11.5v-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 4.2A2.2 2.2 0 0 1 5.2 2h7.6A2.2 2.2 0 0 1 15 4.2v5.1a2.2 2.2 0 0 1-2.2 2.2H8l-3.4 2.6v-2.6H5.2A2.2 2.2 0 0 1 3 9.3Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 5.8h6M6 8.4h4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 5.2h12M3 9h12M3 12.8h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="5.2" r="1.6" fill="currentColor" />
      <circle cx="11" cy="9" r="1.6" fill="currentColor" />
      <circle cx="6" cy="12.8" r="1.6" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="m9 2.3 1 .3.6 1.6 1.6.5 1.2-1 .9.5-.2 1.6 1.1 1.2 1.6.1.3 1-.3 1 1.6 1.1-.5.9-1.6-.2-1.2 1.1-.1 1.6-1 .3-1-.3-1.1 1.6-.9-.5.2-1.6-1.1-1.2-1.6-.1-.3-1 .3-1-1.6-1.1.5-.9 1.6.2 1.2-1.1.1-1.6Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9" cy="9" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

const tools = [
  { id: 'editor', label: 'Editor', icon: GearIcon, tab: 'editor' },
  { id: 'media', label: 'Montage', icon: GridIcon, tab: 'media' },
  { id: 'shorts', label: 'Shorts', icon: WandIcon, tab: 'shorts' },
  { id: 'longmix', label: 'LongMix', icon: LongMixIcon, tab: 'longmix' },
  { id: 'captions', label: 'Captions', icon: BubbleIcon, tab: 'captions' },
];

function getActiveTool(activeTab) {
  if (activeTab === 'media') return 'media';
  if (activeTab === 'shorts') return 'shorts';
  if (activeTab === 'longmix') return 'longmix';
  if (activeTab === 'captions') return 'captions';
  if (activeTab === 'editor') return 'editor';
  return '';
}

function LeftSidebar({ activeTab, onSelect }) {
  const activeTool = getActiveTool(activeTab);

  return (
    <aside className="left-sidebar">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <button
            key={tool.id}
            type="button"
            className={`tool-button ${activeTool === tool.id ? 'is-active' : ''}`}
            onClick={() => onSelect(tool.tab)}
          >
            <Icon />
            <span>{tool.label}</span>
          </button>
        );
      })}
    </aside>
  );
}

export default LeftSidebar;
