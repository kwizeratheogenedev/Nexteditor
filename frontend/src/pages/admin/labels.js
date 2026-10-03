// Human-readable names for AdminAction.action values.
export const ACTION_LABEL = {
  'user.create': 'Account created',
  'user.edit': 'Details edited',
  'user.suspend': 'Suspended',
  'user.unsuspend': 'Reactivated',
  'user.password_reset': 'Password reset',
  'user.delete': 'Deleted',
  'pro.grant': 'Pro granted',
  'pro.revoke': 'Pro removed',
  'quota.reset': 'Export quota reset',
  'role.promote': 'Made admin',
  'role.demote': 'Admin removed',
  'project.delete': 'Project deleted',
};

export const PROVIDER_LABEL = { momo: 'MTN MoMo', card: 'Card', manual: 'Manual' };

// Server operations (backend/models/Operation.js kinds).
export const JOB_KIND_LABEL = {
  montage: 'Montage',
  merge: 'Merge',
  shorts: 'Shorts',
  'short-edit': 'Shorts edit',
  subtitles: 'Burn subtitles',
  captions: 'Auto captions',
  'editor-captions': 'Editor captions',
  'caption-part': 'Captions (part)',
  export: 'Editor export',
  longmix: 'LongMix',
  'link-fetch': 'Link download',
  'youtube-upload': 'YouTube upload',
};

// How long the server worked on something: "850 ms", "42 s", "3 m 05 s", "1 h 12 m".
export function formatProcessingTime(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}
