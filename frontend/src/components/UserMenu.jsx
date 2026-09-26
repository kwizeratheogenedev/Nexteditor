import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar, Badge, userIsPro } from './console/ui.jsx';
import './UserMenu.css';

// The account button in the top bar: opens a menu with the account page,
// the admin panel (admins only), upgrade, and log out.
export default function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const pro = userIsPro(user);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="um-root" ref={rootRef}>
      <button
        type="button"
        className="um-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={user.email}
      >
        <Avatar user={user} size={26} />
        <span className="um-name">{user.name || user.email}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="um-menu" role="menu">
          <div className="um-head">
            <Avatar user={user} size={38} />
            <div>
              <strong>{user.name || 'Your account'}</strong>
              <span>{user.email}</span>
              <div className="um-badges">
                <Badge tone={pro ? 'pro' : 'neutral'}>{pro ? 'Pro' : 'Free'}</Badge>
                {user.isAdmin && <Badge tone="admin">Admin</Badge>}
              </div>
            </div>
          </div>
          <Link role="menuitem" to="/account" className="um-item" onClick={() => setOpen(false)}>Account &amp; billing</Link>
          {user.isAdmin && <Link role="menuitem" to="/admin" className="um-item" onClick={() => setOpen(false)}>Admin panel</Link>}
          {!pro && <Link role="menuitem" to="/pricing" className="um-item um-upgrade" onClick={() => setOpen(false)}>Upgrade to Pro</Link>}
          <div className="um-sep" />
          <button role="menuitem" type="button" className="um-item" onClick={handleLogout}>Log out</button>
        </div>
      )}
    </div>
  );
}
