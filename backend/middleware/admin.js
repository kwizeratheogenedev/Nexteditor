import { isAdmin } from '../services/roles.js';

// Use after requireAuth. Admins are role 'admin' users plus OWNER_EMAILS.
export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: 'Admins only.', code: 'ADMIN_REQUIRED' });
    return;
  }
  next();
}
