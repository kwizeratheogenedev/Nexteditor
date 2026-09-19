// The app owner's own account(s), by email, from OWNER_EMAILS in backend/.env
// (comma-separated). These accounts are never subject to free-tier limits -
// the export length cap, the monthly export quota, the storage and project
// caps, Pro-only resolutions - because they're the accounts the app is run
// from, not customers of it.
//
// This lives in its own module, with no imports of its own, so both the auth
// middleware (which heals the stored subscription) and planLimits (which
// answers "is this account Pro?" on every gate) can consult the same list
// without importing each other.
const OWNER_EMAILS = (process.env.OWNER_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function isOwnerEmail(email) {
  if (!email) return false;
  return OWNER_EMAILS.includes(String(email).trim().toLowerCase());
}

export function ownerEmails() {
  return [...OWNER_EMAILS];
}
