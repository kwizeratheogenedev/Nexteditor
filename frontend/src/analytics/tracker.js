import API_BASE_URL from '../config.js';

// Anonymous usage pings for the admin Analytics page. Each browser gets a
// random visitor id (no name, no IP stored); while a tab is open and
// visible it tells the server "I'm here, in this part of the app" about once
// a minute. Signed-in users are linked by their session cookie.

const PING_EVERY_MS = 60 * 1000;
const MIN_GAP_MS = 15 * 1000;
const ID_KEY = 'nex_vid';
const SOURCE_KEY = 'nex_src';

let workspace = null;
let pendingNew = false;
let lastPing = 0;
let currentPath = '/';

function storage(kind) {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; }
}

function visitorId() {
  const store = storage('local');
  let id = null;
  try { id = store?.getItem(ID_KEY); } catch { /* blocked */ }
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    try { store?.setItem(ID_KEY, id); pendingNew = true; } catch { /* private mode: counted per page load */ }
  }
  return id;
}

// Where this visit came from, captured once per browser session.
function trafficSource() {
  const store = storage('session');
  try {
    const saved = store?.getItem(SOURCE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  let referrer = '';
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.host !== window.location.host) referrer = ref.hostname;
  } catch { /* ignore */ }
  const params = new URLSearchParams(window.location.search);
  const source = { referrer, utm: params.get('utm_source') || '' };
  try { store?.setItem(SOURCE_KEY, JSON.stringify(source)); } catch { /* ignore */ }
  return source;
}

const WORKSPACE_AREA = { editor: 'editor', media: 'montage', captions: 'captions', shorts: 'shorts', longmix: 'longmix' };

function areaFor(pathname) {
  if (pathname === '/') return 'landing';
  if (pathname.startsWith('/pricing')) return 'pricing';
  if (pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/auth')) return 'auth';
  if (pathname.startsWith('/account')) return 'account';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/app')) return WORKSPACE_AREA[workspace] || 'editor';
  return 'other';
}

export function ping(force = false) {
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (!force && now - lastPing < MIN_GAP_MS) return;
  lastPing = now;
  const isNew = pendingNew;
  pendingNew = false;
  const { referrer, utm } = trafficSource();
  fetch(`${API_BASE_URL}/api/analytics/ping`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId: visitorId(), area: areaFor(currentPath), referrer, utm, isNew }),
  }).catch(() => { /* analytics must never disturb the app */ });
}

export function setPath(pathname) {
  currentPath = pathname;
  ping();
}

// Called by the editor's top bar when the user switches tool tab.
export function setWorkspace(tab) {
  if (workspace === tab) return;
  workspace = tab;
  ping();
}

let started = false;
export function startTracking() {
  if (started || typeof window === 'undefined') return;
  started = true;
  visitorId();
  setInterval(() => ping(true), PING_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ping();
  });
}
