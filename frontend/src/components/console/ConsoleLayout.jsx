import { Link } from 'react-router-dom';
import ThemeToggle from '../ThemeToggle.jsx';
import UserMenu from '../UserMenu.jsx';

const ICONS = {
  overview: 'M4 13h6V4H4z M14 20h6v-9h-6z M14 4v4h6V4z M4 20h6v-4H4z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1 M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M22 19v-1a4 4 0 0 0-3-3.87 M16 4.13a3 3 0 0 1 0 5.74',
  payments: 'M3 6h18v12H3z M3 10h18 M7 15h3',
  jobs: 'M4 4h16v16H4z M9 9l6 3-6 3z',
  projects: 'M3 7h7l2 2h9v10H3z',
  activity: 'M4 12h3l2-6 3 12 3-9 2 3h3',
  system: 'M4 5h16v10H4z M8 19h8 M12 15v4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 20a8 8 0 0 1 16 0',
  plan: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',
  usage: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  security: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  connected: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  danger: 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

export function NavIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// Page shell shared by /account and /admin: top bar, section nav, content.
export default function ConsoleLayout({ title, badge, sections, active, onSelect, children }) {
  return (
    <div className="cs-shell">
      <header className="cs-topbar">
        <div className="cs-topbar-left">
          <Link to="/app" className="cs-brand">Nex<span>Editor</span></Link>
          <span className="cs-topbar-title">{title}</span>
          {badge}
        </div>
        <div className="cs-topbar-right">
          <Link to="/app" className="cs-btn cs-btn-ghost cs-btn-sm">Open editor</Link>
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <div className="cs-body">
        <nav className="cs-nav" aria-label={`${title} sections`}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cs-nav-item ${active === s.id ? 'is-active' : ''} ${s.tone === 'danger' ? 'is-danger' : ''}`}
              aria-current={active === s.id ? 'page' : undefined}
              onClick={() => onSelect(s.id)}
            >
              <NavIcon name={s.icon} />
              <span>{s.label}</span>
              {s.count !== undefined && s.count !== null && <em>{s.count}</em>}
            </button>
          ))}
        </nav>
        <main className="cs-main">{children}</main>
      </div>
    </div>
  );
}
