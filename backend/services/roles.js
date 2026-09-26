import { isOwnerEmail } from './owners.js';

// Admins are users with role 'admin' in the database, plus the OWNER_EMAILS
// accounts from backend/.env - those are always admins, so the owner can
// never be locked out of the admin panel by a demotion or a DB mistake.
export function isAdmin(user) {
  if (!user) return false;
  return user.role === 'admin' || isOwnerEmail(user.email);
}

export function isSuspended(user) {
  return user?.status === 'suspended';
}
