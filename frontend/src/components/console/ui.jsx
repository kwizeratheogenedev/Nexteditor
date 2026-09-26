/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useRef, useState } from 'react';
import './console.css';

// Small shared building blocks for the Account and Admin pages.

export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, withTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(value) {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (!currency) return n.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds) {
  const s = Number(seconds) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function Avatar({ user, size = 36 }) {
  const label = (user?.name || user?.email || '?').trim();
  const initials = label.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  if (user?.avatarUrl) {
    return <img className="cs-avatar" src={user.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" />;
  }
  return <span className="cs-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{initials}</span>;
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`cs-badge cs-badge-${tone}`}>{children}</span>;
}

export function Meter({ label, used, limit, format = (v) => v, hint, unlimitedLabel = 'Unlimited on your plan' }) {
  const unlimited = limit === null || limit === undefined;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = unlimited ? 'ok' : pct >= 100 ? 'full' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className="cs-meter">
      <div className="cs-meter-head">
        <span>{label}</span>
        <strong>{format(used)}{unlimited ? '' : ` / ${format(limit)}`}</strong>
      </div>
      <div className={`cs-meter-track is-${tone}`} role="progressbar" aria-valuenow={unlimited ? undefined : pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span style={{ width: unlimited ? '100%' : `${pct}%` }} className={unlimited ? 'is-unlimited' : ''} />
      </div>
      {(hint || unlimited) && <p className="cs-meter-hint">{unlimited ? unlimitedLabel : hint}</p>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`cs-card ${className}`}>
      {(title || actions) && (
        <header className="cs-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="cs-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="cs-empty">{children}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="cs-loading"><span className="cs-spinner" aria-hidden="true" />{label}</div>;
}

export function Modal({ title, onClose, children, footer, width = 480 }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="cs-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cs-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} ref={ref}>
        <header className="cs-modal-head">
          <h3>{title}</h3>
          <button type="button" className="cs-icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="cs-modal-body">{children}</div>
        {footer && <footer className="cs-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Minimal toast queue: const { toast, toasts } = useToasts(); toast('Saved')
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);
  const view = (
    <div className="cs-toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`cs-toast is-${t.tone}`}>{t.message}</div>)}
    </div>
  );
  return { toast, toasts: view };
}

export function Pager({ page, pages, total, onPage }) {
  if (pages <= 1) return total ? <div className="cs-pager"><span>{total} total</span></div> : null;
  return (
    <div className="cs-pager">
      <span>{total} total · page {page} of {pages}</span>
      <div>
        <button type="button" className="cs-btn cs-btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button type="button" className="cs-btn cs-btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

// Client-side mirror of the server's isPro (planLimits.js), for display only.
export function userIsPro(user) {
  if (!user) return false;
  const sub = user.subscription || {};
  if (sub.plan !== 'pro' || sub.status !== 'active') return false;
  return !sub.currentPeriodEnd || new Date(sub.currentPeriodEnd).getTime() > Date.now();
}
